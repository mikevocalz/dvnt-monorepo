import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Migrations that redefine a live function quote the LIVE definition they
// replace (read with pg_get_functiondef) and record its live md5. These checks
// hold each one to "the live body plus exactly these edits": the quoted text
// hashes to the recorded md5, and applying the edits below to it yields the
// new body byte for byte. Any other drift from production fails here.
const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../apps/mobile/supabase/migrations",
);

const VIS = "      AND COALESCE(e.visibility, 'public') = 'public'\n";
const LISTABLE =
  VIS + "      AND NOT e.is_hidden\n      AND (e.publish_at IS NULL OR e.publish_at <= now())\n";
const TZ: [string, string] = ["      e.cancelled_at,\n", "      e.cancelled_at,\n      e.event_tz,\n"];
const HOME11 =
  "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text,boolean)";
const HOME10 =
  "public.get_events_home(integer,integer,integer,integer,boolean,boolean,boolean,text,text,text)";

const EXPECTED: Record<string, Record<string, [string, string][]>> = {
  "20261003120000_discovery_rpcs_return_event_tz.sql": {
    // Live Home has no status filter (20260916190000 never reached production),
    // so cancelled, draft and suspended events were listed. get_events_for_you
    // already has this line.
    [HOME11]: [
      TZ,
      [
        VIS,
        LISTABLE +
          "      AND COALESCE(e.status, 'active') NOT IN ('cancelled', 'canceled', 'draft', 'suspended')\n",
      ],
    ],
    "public.get_events_for_you(integer,integer,integer)": [TZ, [VIS, LISTABLE]],
  },
  "20261003110000_event_hide_and_publish_at.sql": {
    "public.can_view_event(integer)": [[
      "      OR COALESCE(e.visibility, 'public') <> 'private'\n",
      "      OR (COALESCE(e.visibility, 'public') <> 'private'\n" +
        "          AND NOT e.is_hidden\n" +
        "          AND (e.publish_at IS NULL OR e.publish_at <= now()))\n",
    ]],
    "public.get_event_by_share_token(text)": [[
      "        NOT IN ('draft', 'cancelled', 'canceled', 'suspended')\n",
      "        NOT IN ('draft', 'cancelled', 'canceled', 'suspended')\n    AND public.can_view_event(e.id)\n",
    ]],
    "public.get_event_detail(integer,integer)": [[
      "e.event_tz, e.lynk_room_id\n",
      "e.event_tz, e.lynk_room_id,\n      e.is_hidden, e.publish_at\n",
    ]],
    [HOME10]: [[VIS, LISTABLE]],
    "public.get_spotlight_feed(bigint)": [[VIS, LISTABLE]],
    "public.get_promoted_event_ids(bigint)": [[VIS, LISTABLE]],
    "public.issue_guest_rsvp_tickets(integer,text,text,text[],integer,text)": [
      [
        "select id, ticketing_enabled, status, visibility, max_attendees, title, attendee_name_requirement\n",
        "select id, ticketing_enabled, status, visibility, max_attendees, title, attendee_name_requirement,\n         is_hidden, publish_at\n",
      ],
      [
        "  if v_event.visibility <> 'public' then return json_build_object('error','event_not_found'); end if;\n",
        "  if v_event.visibility <> 'public' then return json_build_object('error','event_not_found'); end if;\n" +
          "  if v_event.is_hidden or (v_event.publish_at is not null and v_event.publish_at > now()) then\n" +
          "    return json_build_object('error','event_not_found');\n" +
          "  end if;\n",
      ],
    ],
  },
};

function parse(file: string) {
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const live = new Map<string, { md5: string; text: string }>();
  const re = /^-- BEGIN LIVE (\S+) md5=([0-9a-f]{32})\n([\s\S]*?)^-- END LIVE$/gm;
  for (const m of sql.matchAll(re)) {
    const lines = m[3].split("\n");
    lines.pop(); // trailing "" after the last quoted line's newline
    const text = lines.map((l) => (l === "-- |" ? "" : l.replace(/^-- \| /, ""))).join("\n") + "\n";
    live.set(m[1], { md5: m[2], text });
  }
  const code = sql
    .split("\n")
    .filter((l) => !l.startsWith("--"))
    .join("\n");
  const bodies = [...code.matchAll(/^CREATE OR REPLACE FUNCTION[\s\S]*?^\$function\$;\n/gm)].map((m) =>
    m[0].replace(/;\n$/, "\n"),
  );
  return { live, bodies, code };
}

function signatureOf(def: string): string {
  // "public.name(p_a integer DEFAULT 20, p_b text[] ...)" -> "public.name(integer,text[])"
  const m = /FUNCTION (public\.\w+)\(([^)]*)\)/.exec(def);
  assert.ok(m, "no signature");
  const types = m[2]
    .split(/,(?![^(]*\))/)
    .map((a) => a.trim().replace(/\s+DEFAULT[\s\S]*$/i, "").split(/\s+/).slice(1).join(" "))
    .filter(Boolean);
  return `${m[1]}(${types.join(",")})`;
}

for (const [file, expected] of Object.entries(EXPECTED)) {
  test(`${file}: quoted definitions are the live ones`, () => {
    const { live } = parse(file);
    assert.deepEqual([...live.keys()].sort(), Object.keys(expected).sort());
    for (const [sig, { md5, text }] of live) {
      assert.equal(createHash("md5").update(text).digest("hex"), md5, sig);
    }
  });

  test(`${file}: each new body is the live body plus only its listed edits`, () => {
    const { live, bodies } = parse(file);
    assert.equal(bodies.length, Object.keys(expected).length);
    for (const body of bodies) {
      const sig = signatureOf(body);
      const edits = expected[sig];
      assert.ok(edits, `unexpected redefinition ${sig}`);
      let want = live.get(sig)!.text;
      for (const [from, to] of edits) {
        assert.equal(want.split(from).length - 1, 1, `${sig}: anchor not unique: ${from}`);
        want = want.replace(from, to);
      }
      assert.equal(body, want, sig);
    }
  });

  test(`${file}: no CHECK constraint, trigger, grant or drop`, () => {
    const { code } = parse(file);
    assert.doesNotMatch(code, /\bCHECK\s*\(|\bTRIGGER\b|\bGRANT\b|\bREVOKE\b|\bDROP\b/i);
  });
}

test("the columns are added without a constraint", () => {
  const { code } = parse("20261003110000_event_hide_and_publish_at.sql");
  assert.match(code, /ADD COLUMN IF NOT EXISTS publish_at timestamptz,/);
  assert.match(code, /ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;/);
  assert.equal((code.match(/ALTER TABLE/g) || []).length, 1);
});
