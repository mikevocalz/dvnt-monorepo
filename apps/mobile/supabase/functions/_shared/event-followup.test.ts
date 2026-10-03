import {
  buildFollowupEmail,
  type ExistingCampaign,
  normaliseFollowupInput,
  planFollowupSave,
  recipientsToEnqueue,
  signUnsubscribeToken,
  suppressionDecision,
  verifyUnsubscribeToken,
} from "./event-followup.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const NOW = "2026-10-03T12:00:00.000Z";
const AT = "2026-10-04T08:00:00.000Z";
const saved: ExistingCampaign = {
  enabled: true,
  subject: "How was it?",
  message: "Thanks for coming",
  cta_label: "Leave a review",
  delay_minutes: 600,
  campaign_version: 3,
  status: "sent",
  scheduled_at: "2026-10-04T08:00:00+00:00",
};
const sameBody = {
  enabled: true,
  subject: " How was it? ",
  message: "Thanks for coming",
  cta_label: "Leave a review",
  delay_minutes: 600,
};

// ── campaign_version ────────────────────────────────────────────────────

Deno.test("first save creates version 1", () => {
  const plan = planFollowupSave(null, normaliseFollowupInput(sameBody), AT, "a", NOW);
  assert(plan.write && plan.row.campaign_version === 1, "first version");
  assert(plan.row.status === "scheduled", "first save schedules");
});

Deno.test("no-op save on a sent campaign writes nothing and keeps the version", () => {
  const plan = planFollowupSave(saved, normaliseFollowupInput(sameBody), AT, "a", NOW);
  assert(!plan.write, "no-op save must not write (it would reschedule a sent campaign)");
  assert(!plan.versionBumped, "no-op save bumped the version");
});

Deno.test("toggling enabled alone keeps the version", () => {
  const off = planFollowupSave(saved, normaliseFollowupInput({ ...sameBody, enabled: false }), AT, "a", NOW);
  assert(off.write && off.row.campaign_version === 3 && off.row.status === "disabled", "disable");
  const on = planFollowupSave({ ...saved, enabled: false, status: "disabled" }, normaliseFollowupInput(sameBody), AT, "a", NOW);
  assert(on.write && on.row.campaign_version === 3 && on.row.status === "scheduled", "re-enable");
});

Deno.test("changing mailed content or send time bumps the version once", () => {
  for (const change of [
    { subject: "New subject" },
    { message: "New body" },
    { cta_label: "Rate it" },
    { delay_minutes: 60 },
  ]) {
    const plan = planFollowupSave(saved, normaliseFollowupInput({ ...sameBody, ...change }), AT, "a", NOW);
    assert(plan.write && plan.versionBumped && plan.row.campaign_version === 4, `no bump for ${JSON.stringify(change)}`);
  }
});

Deno.test("no-op save on a still-scheduled campaign follows a moved event without a bump", () => {
  const scheduled = { ...saved, status: "scheduled" };
  const same = planFollowupSave(scheduled, normaliseFollowupInput(sameBody), AT, "a", NOW);
  assert(!same.write, "same time must not write");
  const moved = planFollowupSave(scheduled, normaliseFollowupInput(sameBody), "2026-10-05T08:00:00.000Z", "a", NOW);
  assert(moved.write && moved.row.campaign_version === undefined && moved.row.scheduled_at === "2026-10-05T08:00:00.000Z", "moved");
});

Deno.test("a new version never re-enqueues someone already mailed for the event", () => {
  const tickets = [
    { id: "t1", user_id: "u1", guest_email: null },
    { id: "t2", user_id: null, guest_email: "Guest@Example.com" },
    { id: "t3", user_id: null, guest_email: "new@example.com" },
    { id: "t4", user_id: null, guest_email: "new@example.com" },
  ];
  const emailByAuth = new Map([["u1", "member@example.com"]]);
  const out = recipientsToEnqueue(tickets, emailByAuth, new Set(["member@example.com", "guest@example.com"]));
  assert(out.size === 1 && out.has("new@example.com"), `got ${[...out.keys()]}`);
});

// ── suppression ─────────────────────────────────────────────────────────

Deno.test("suppression gate fails closed", () => {
  assert(suppressionDecision({ lookupFailed: false, addressUnsubscribed: false, memberOptedOut: false }) === "send", "send");
  assert(suppressionDecision({ lookupFailed: false, addressUnsubscribed: true, memberOptedOut: false }) === "suppress", "address");
  assert(suppressionDecision({ lookupFailed: false, addressUnsubscribed: false, memberOptedOut: true }) === "suppress", "member");
  assert(suppressionDecision({ lookupFailed: true, addressUnsubscribed: false, memberOptedOut: false }) === "retry", "lookup error must not send");
});

Deno.test("unsubscribe token round-trips and rejects tampering", async () => {
  const token = await signUnsubscribeToken("s3cret", "Person@Example.com");
  assert((await verifyUnsubscribeToken("s3cret", token)) === "person@example.com", "round trip");
  assert((await verifyUnsubscribeToken("other", token)) === null, "wrong secret accepted");
  assert((await verifyUnsubscribeToken("", token)) === null, "empty secret accepted");
  const [, sig] = token.split(".");
  const forged = `${btoa("victim@example.com").replace(/=+$/, "")}.${sig}`;
  assert((await verifyUnsubscribeToken("s3cret", forged)) === null, "swapped address accepted");
  for (const bad of ["", "abc", "a.b.c", "!!.!!", `${token}x`]) {
    assert((await verifyUnsubscribeToken("s3cret", bad)) === null, `accepted ${bad}`);
  }
});

Deno.test("email carries a visible unsubscribe link and one-click headers", () => {
  const url = "https://x.supabase.co/functions/v1/event-followup-unsubscribe?token=a.b";
  const mail = buildFollowupEmail({
    eventTitle: "<Party>",
    subject: null,
    message: "hi",
    ctaLabel: null,
    reviewUrl: "https://dvntapp.live/feed/events/1/reviews",
    unsubscribeUrl: url,
  });
  assert(mail.headers["List-Unsubscribe"] === `<${url}>`, "List-Unsubscribe");
  assert(mail.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "one-click");
  assert(mail.html.includes(`href="${url}"`), "body link");
  assert(!mail.html.includes("<Party>"), "title not escaped");
  assert(mail.subject === "How was <Party>?", "default subject");
});
