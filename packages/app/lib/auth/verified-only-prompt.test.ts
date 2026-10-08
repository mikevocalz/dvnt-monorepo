import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  GATED_FUNCTIONS,
  VERIFIED_ONLY_COPY,
  canVerify,
  gateDecision,
  readAdmissionRefusal,
  requireVerified,
  useVerifiedOnlyPromptStore,
} from "./verified-only-prompt.ts";
import { decideVerifiedAdmission } from "./verified-admission.ts";
import { admissionRefusal } from "../../../../apps/mobile/supabase/functions/_shared/verified-admission.ts";
import type { AdmissionVerdict } from "./verified-admission.ts";

const FUNCTIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../apps/mobile/supabase/functions");
const now = new Date("2026-09-16T00:00:00Z");
const MEMBER = "auth_member";
const verdictFor = (policy: { enforce: boolean; grace_deadline?: string | null }, record: unknown = null) =>
  decideVerifiedAdmission({ userId: MEMBER, policy, record: record as never, now });

const ALLOWED = verdictFor({ enforce: false });
const GRACE = verdictFor({ enforce: true, grace_deadline: "2026-12-01T00:00:00Z" });
const BLOCKED = verdictFor({ enforce: true, grace_deadline: null });
const UNDERAGE = verdictFor(
  { enforce: true },
  { user_id: MEMBER, status: "passed", date_of_birth: "2012-01-01" },
);

beforeEach(() => useVerifiedOnlyPromptStore.getState().close());

const isOpen = () => useVerifiedOnlyPromptStore.getState().open;

test("copy is the product owner's wording, curly quotes included", () => {
  assert.equal(VERIFIED_ONLY_COPY.title, "OOPS:");
  assert.deepEqual(VERIFIED_ONLY_COPY.lines, [
    "This is for VERIFIED USERS ONLY.",
    "Post, Host Events, DM & Comment as a Verified User.",
    "“Sneaky Links” and “Spicy” content included for VERIFIED accounts only.",
  ]);
});

test("allowed verdict runs the action and never opens the popup", () => {
  assert.equal(ALLOWED.state, "allowed");
  let ran = 0;
  for (const action of ["post", "host_event", "message", "comment", "sneaky_lynk", "spicy"] as const) {
    assert.equal(requireVerified({ verdict: ALLOWED, graceDismissed: false, action }, () => ran++), true);
  }
  assert.equal(ran, 6);
  assert.equal(isOpen(), false);
});

test("no verdict yet stays quiet: the server is the gate", () => {
  assert.equal(gateDecision(undefined, false), "run");
  assert.equal(gateDecision(null, false), "run");
});

test("blocked verdict opens the popup and does not run the action", () => {
  assert.equal(BLOCKED.state, "blocked");
  let ran = 0;
  assert.equal(requireVerified({ verdict: BLOCKED, graceDismissed: false, action: "post" }, () => ran++), false);
  assert.equal(ran, 0);
  const state = useVerifiedOnlyPromptStore.getState();
  assert.equal(state.open, true);
  assert.equal(state.reason, "verification_required");
  assert.equal(state.action, "post");
  // "Not now" on a blocked verdict has nothing to carry on with.
  state.dismiss();
  assert.equal(ran, 0);
  assert.equal(isOpen(), false);
});

test("grace verdict opens the popup; Not now carries on and is remembered", () => {
  assert.equal(GRACE.state, "grace");
  let ran = 0;
  let remembered = false;
  const input = {
    verdict: GRACE,
    graceDismissed: false,
    action: "message" as const,
    onGraceDismiss: () => { remembered = true; },
  };
  assert.equal(requireVerified(input, () => ran++), false);
  assert.equal(isOpen(), true);
  useVerifiedOnlyPromptStore.getState().dismiss();
  assert.equal(ran, 1, "the server still admits grace members, so the action proceeds");
  assert.equal(remembered, true);
  // Once dismissed this launch, grace runs straight through.
  assert.equal(requireVerified({ ...input, graceDismissed: true }, () => ran++), true);
  assert.equal(ran, 2);
  assert.equal(isOpen(), false);
});

test("closing a grace popup (backdrop, Esc, back) does not run the action", () => {
  let ran = 0;
  requireVerified({ verdict: GRACE, graceDismissed: false, action: "comment" }, () => ran++);
  useVerifiedOnlyPromptStore.getState().close();
  assert.equal(ran, 0);
});

test("underage hides the verify button, every other refusal shows it", () => {
  assert.equal(UNDERAGE.reason, "underage");
  assert.equal(canVerify(UNDERAGE.reason), false);
  for (const reason of ["verification_required", "verification_incomplete", "age_evidence_missing", "restricted_profile", null] as const) {
    assert.equal(canVerify(reason), true, String(reason));
  }
  requireVerified({ verdict: UNDERAGE, graceDismissed: false, action: "spicy" }, () => {});
  assert.equal(useVerifiedOnlyPromptStore.getState().reason, "underage");
});

test("a second open while the popup is up keeps the first", () => {
  useVerifiedOnlyPromptStore.getState().show({ reason: "underage", action: "post" });
  useVerifiedOnlyPromptStore.getState().show({ reason: "verification_required", action: "comment" });
  assert.equal(useVerifiedOnlyPromptStore.getState().reason, "underage");
  assert.equal(useVerifiedOnlyPromptStore.getState().action, "post");
});

test("server refusal bodies from every rail shape open the popup", () => {
  const refusal = admissionRefusal(BLOCKED as AdmissionVerdict);
  // create-post / update-post / create-story / create-event / send-message / add-comment
  assert.equal(readAdmissionRefusal({ ok: false, error: { code: refusal.code, message: refusal.message } }), "verification_required");
  // video_create_room / video_join_room / lynk-moq-token / lynk-livestream-token
  assert.equal(
    readAdmissionRefusal({ ok: false, error: { code: "forbidden", message: refusal.message, detail: { reason: "underage" } } }),
    "underage",
  );
  // creator-program shape
  assert.equal(
    readAdmissionRefusal({ ok: false, error: refusal.message, code: "verification_required", reason: "verification_incomplete" }),
    "verification_incomplete",
  );
});

test("other errors and successes do not open the popup", () => {
  for (const body of [
    null,
    "nope",
    { ok: true, data: { id: 1 } },
    { ok: false, error: { code: "forbidden", message: "Only the host can end this room" } },
    { ok: false, error: { code: "forbidden", message: "x", detail: { reason: "room_full" } } },
    { ok: false, error: { code: "rate_limited", message: "Slow down" } },
    { ok: false, error: { code: "validation_error", message: "Invalid JSON body" } },
    { ok: false, error: { code: "adult_verification_required", message: "first-post campaign has its own copy" } },
  ]) {
    assert.equal(readAdmissionRefusal(body), null, JSON.stringify(body));
  }
});

test("ticket, checkout, cart, RSVP, transfer and claim rails never open the popup", () => {
  // Buying a ticket needs no account and no verification. No ticket rail may be
  // observed, whatever it answers.
  const functionsDir = FUNCTIONS_DIR;
  const ticketRails = readdirSync(functionsDir).filter((name) =>
    /ticket|checkout|cart|rsvp|payment|order|guest|comp|claim|transfer|waitlist|door|refund|wallet/i.test(name),
  );
  assert.ok(ticketRails.length >= 20, `expected the ticket rails, found ${ticketRails.join(", ")}`);
  const gated = new Set(GATED_FUNCTIONS);
  for (const name of ticketRails) assert.equal(gated.has(name), false, `${name} must not be gated`);

  // Even a ticket rail that sent an admission-shaped refusal is not observed:
  // the observer filters on GATED_FUNCTIONS before it reads a body.
  const refusalBody = { ok: false, error: { code: "verification_required", message: "x" } };
  assert.equal(readAdmissionRefusal(refusalBody), "verification_required");
  assert.equal(GATED_FUNCTIONS.includes("ticket-checkout"), false);
  assert.equal(isOpen(), false);
});

test("every gated function exists and calls the admission gate", async () => {
  const { readFileSync } = await import("node:fs");
  for (const name of GATED_FUNCTIONS) {
    const src = readFileSync(resolve(FUNCTIONS_DIR, name, "index.ts"), "utf8");
    assert.match(src, /resolveVerifiedAdmission\(/, `${name} no longer calls resolveVerifiedAdmission`);
    assert.match(src, /admissionRefusal\(/, `${name} no longer answers with admissionRefusal`);
  }
});

test("the fetch observer sees gated rails only and leaves the caller's response intact", async () => {
  const { withFunctionObserver, setFunctionResponseObserver } = await import(
    "../../../supabase/src/function-observer.ts"
  );
  const body = JSON.stringify({ ok: false, error: { code: "verification_required", message: "x" } });
  const base = (async () => new Response(body, { status: 403 })) as typeof fetch;
  const seen: Array<Promise<string | null>> = [];
  const gated = new Set(GATED_FUNCTIONS);
  setFunctionResponseObserver({
    matches: (fn: string) => gated.has(fn),
    observe: (_fn: string, res: Response) => {
      seen.push(res.json().then((b: unknown) => readAdmissionRefusal(b)));
    },
  });
  try {
    const wrapped = withFunctionObserver(base);
    const direct = await wrapped("https://x.supabase.co/functions/v1/create-post", { method: "POST" });
    const proxied = await wrapped("https://dvnt.app/api/fn/add-comment", { method: "POST" });
    const ticket = await wrapped("https://x.supabase.co/functions/v1/ticket-checkout", { method: "POST" });
    const guest = await wrapped("https://dvnt.app/api/fn/guest-checkout", { method: "POST" });
    // Callers still read their own bodies.
    for (const res of [direct, proxied, ticket, guest]) assert.equal(await res.text(), body);
    assert.equal(seen.length, 2, "only create-post and add-comment are observed");
    assert.deepEqual(await Promise.all(seen), ["verification_required", "verification_required"]);
  } finally {
    setFunctionResponseObserver(null);
  }
});

test("no ticket, checkout, cart or RSVP screen asks for verification", async () => {
  const { readFileSync, readdirSync: list, statSync } = await import("node:fs");
  const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const users: string[] = [];
  const walk = (dir: string) => {
    for (const name of list(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = resolve(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && /use-verified-gate|requireVerified\(/.test(readFileSync(full, "utf8"))) {
        users.push(full.slice(appRoot.length + 1));
      }
    }
  };
  walk(appRoot);
  assert.ok(users.length > 10, `expected the gate's call sites, found ${users.length}`);
  const ticketish = /ticket|checkout|cart|rsvp|guest|wallet|door|comp-claim|purchase|order/i;
  for (const file of users) assert.doesNotMatch(file, ticketish, `${file} must not gate on verification`);
});
