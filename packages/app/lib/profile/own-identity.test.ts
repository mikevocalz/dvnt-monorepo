import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchOwnIdentity,
  identityPatch,
  onboardingState,
  type OwnIdentity,
} from "./own-identity.ts";

const STORED: OwnIdentity = { gender: "Nonbinary", sexuality: ["Queer"], eventAudience: "Everyone" };
const BLANK: OwnIdentity = { gender: "", sexuality: [], eventAudience: "" };

function client(result: { data: any; error: unknown } | Error) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (result instanceof Error) throw result;
            return result;
          },
        }),
      }),
    }),
  };
}

test("a 42501 (anon before the JWT attaches) is a failed read, not blank values", async () => {
  const r = await fetchOwnIdentity(client({ data: null, error: { code: "42501" } }), "7");
  assert.deepEqual(r, { ok: false });
});

test("a missing row and a thrown request are failed reads too", async () => {
  assert.deepEqual(await fetchOwnIdentity(client({ data: null, error: null }), "7"), { ok: false });
  assert.deepEqual(await fetchOwnIdentity(client(new Error("offline")), "7"), { ok: false });
});

test("a stored row reads back as the member's identity", async () => {
  const r = await fetchOwnIdentity(
    client({ data: { gender: "Nonbinary", sexuality: ["Queer"], event_audience: "Everyone" }, error: null }),
    "7",
  );
  assert.deepEqual(r, { ok: true, identity: STORED });
});

test("after a failed prefill the blank form sends no identity fields", () => {
  assert.deepEqual(identityPatch({ status: "error" }, BLANK), {});
  assert.deepEqual(identityPatch({ status: "loading" }, BLANK), {});
  // Even if the member somehow picked values, nothing is sent without a baseline.
  assert.deepEqual(identityPatch({ status: "error" }, STORED), {});
});

test("unchanged fields are omitted", () => {
  assert.deepEqual(identityPatch({ status: "ready", baseline: STORED }, STORED), {});
});

test("changed fields are sent; changed to empty is an explicit null", () => {
  assert.deepEqual(
    identityPatch({ status: "ready", baseline: STORED }, { gender: "Woman", sexuality: [], eventAudience: "Everyone" }),
    { gender: "Woman", sexuality: null },
  );
  assert.deepEqual(identityPatch({ status: "ready", baseline: BLANK }, STORED), {
    gender: "Nonbinary",
    sexuality: ["Queer"],
    eventAudience: "Everyone",
  });
  assert.deepEqual(
    identityPatch({ status: "ready", baseline: STORED }, { ...STORED, eventAudience: "" }),
    { eventAudience: null },
  );
});

test("a failed read is never 'not onboarded'", () => {
  assert.equal(onboardingState({ ok: false }), "unknown");
  assert.equal(onboardingState({ ok: true, identity: BLANK }), "needed");
  assert.equal(onboardingState({ ok: true, identity: STORED }), "done");
});

// The screens must go through this module: before, each read the row itself,
// treated a failed read as empty, and saved the form's blanks unconditionally.
const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const SCREENS = {
  editWeb: "packages/app/features/profile/edit-profile.web.tsx",
  editNative: "packages/app/features/routes/screens/(protected)/edit-profile.tsx",
  welcomeWeb: "packages/app/features/auth/screens/WelcomeScreen.web.tsx",
  welcomeNative: "packages/app/features/routes/screens/(protected)/welcome.tsx",
};
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

test("both edit-profile screens save identity only through identityPatch", () => {
  for (const rel of [SCREENS.editWeb, SCREENS.editNative]) {
    const src = read(rel);
    assert.match(src, /fetchOwnIdentity\(supabase/, `${rel} must prefill via fetchOwnIdentity`);
    assert.match(src, /\.\.\.identityPatch\(/, `${rel} must build identity fields with identityPatch`);
    // The old payloads: every identity field, straight from the form.
    assert.doesNotMatch(src, /gender: s\.gender\.trim\(\),/, `${rel} still sends gender unconditionally`);
    assert.doesNotMatch(
      src,
      /pronouns: nextPronouns,\s*gender: nextGender,/,
      `${rel} still sends identity fields unconditionally`,
    );
  }
});

test("both welcome screens decide onboarding with onboardingState and show a retry on failure", () => {
  for (const rel of [SCREENS.welcomeWeb, SCREENS.welcomeNative]) {
    const src = read(rel);
    assert.match(src, /onboardingState\(result\)/, `${rel} must use onboardingState`);
    assert.match(src, /=== ["']unknown["']/, `${rel} must handle a failed read`);
    assert.match(src, /Try again/, `${rel} must offer a retry`);
  }
});

test("no screen reads the identity columns directly", () => {
  for (const rel of Object.values(SCREENS)) {
    assert.doesNotMatch(read(rel), /\.select\(\s*["'`]sexuality/, `${rel} reads users identity directly`);
  }
});
