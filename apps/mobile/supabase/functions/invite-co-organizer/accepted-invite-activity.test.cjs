const { readFileSync } = require("node:fs");
const { stripTypeScriptTypes } = require("node:module");
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Run the actual HTTP handler; replace only network/platform dependencies.
const source = readFileSync(require.resolve("./index.ts"), "utf8")
  .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];\n/gm, "");
const wire = new Function("Deno", "createClient", "verifySession", "corsHeaders",
  "optionsResponse", "checkRateLimit", "fetch", "console", stripTypeScriptTypes(source));
const inviteId = "11111111-2222-4333-8444-555555555555";
const exact = { recipient_id: 10, actor_id: 20, type: "event_co_organizer_invited", entity_type: "event", entity_id: inviteId };

function fixture({ accepted = false, cleanupFails = false, acceptRaces = false,
  memberReadFails = false, profileReadFails = false } = {}) {
  const db = {
    event_co_organizers: [{ id: inviteId, event_id: 11, user_id: "invitee", invited_by: "inviter", role: "editor", accepted }],
    users: [{ auth_id: "invitee", id: 10, username: "guest" }, { auth_id: "inviter", id: 20, username: "host" }],
    notifications: [
      exact, { ...exact },
      { ...exact, recipient_id: 99 }, { ...exact, actor_id: 99 },
      { ...exact, entity_id: "another-invite" }, { ...exact, entity_type: "room" },
      { ...exact, type: "like" },
    ],
    push_tokens: [],
  };
  let deletes = 0, updates = 0, handler;
  const supabase = { from(table) {
    let op = "read", payload, returning = false;
    const conditions = [];
    function execute(single = false) {
      if (op === "read" && ((table === "event_co_organizers" && memberReadFails) ||
        (table === "users" && profileReadFails))) return { error: { message: "transient" } };
      if (op === "update" && table === "event_co_organizers" && acceptRaces) db[table][0].role = "scanner";
      const matches = db[table].filter(row => conditions.every(([key, val]) => row[key] === val));
      if (op === "update") { updates++; matches.forEach(row => Object.assign(row, payload)); }
      if (op === "delete") {
        deletes++;
        if (cleanupFails) return { error: { message: "temporary delete failure" } };
        db[table] = db[table].filter(row => !matches.includes(row));
      }
      if (op === "insert") db[table].push(payload);
      return { error: null, data: op === "read" || returning ? single ? matches[0] ?? null : matches : null };
    }
    return {
      select() { returning = true; return this; },
      eq(k, v) { conditions.push([k, v]); return this; },
      is(k, v) { conditions.push([k, v]); return this; },
      delete() { op = "delete"; return this; },
      insert(data) { op = "insert"; payload = data; return this; },
      update(data) { op = "update"; payload = data; return this; },
      maybeSingle() { return Promise.resolve(execute(true)); },
      then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
    };
  }};
  wire({ env: { get() {} }, serve(fn) { handler = fn; } }, () => supabase,
    async (_, req) => req.headers.get("x-fixture-session"), () => ({}), () => new Response(),
    () => ({ allowed: true }), () => assert.fail("Do not send notifications to external push in tests"), { warn() {}, error() {} });
  const unrelated = () => db.notifications.filter(row => ![exact.type, "event_co_organizer_accepted"].includes(row.type) ||
    row.recipient_id !== 10 || row.actor_id !== 20 || row.entity_id !== inviteId || row.entity_type !== "event");
  const untouched = unrelated().length;
  return {
    db, unrelated, untouched,
    updateCount: () => updates, deleteCount: () => deletes,
    newlyAcceptedMessages: () => db.notifications.filter(r => r.type === "event_co_organizer_accepted").length,
    pending: () => db.notifications.filter(r => Object.keys(exact).every(k => r[k] === exact[k])).length,
    disableCleanupFailure: () => { cleanupFails = false; profileReadFails = false; },
    accept: (user = "invitee") => handler(new Request("https://fixture.invalid/invite-co-organizer", {
      method: "POST", headers: user ? { "x-fixture-session": user } : {},
      body: JSON.stringify({ action: "accept", invite_id: inviteId }),
    })),
  };
}

test("recipient accepts and only duplicates of that exact pending notification disappear across reads", async () => {
  const f = fixture();
  assert.equal((await f.accept()).status, 200);
  assert.equal(f.db.event_co_organizers[0].accepted, true);
  assert.equal(f.pending(), 0);
  assert.equal(f.newlyAcceptedMessages(), 1);
  assert.equal(f.unrelated().length, f.untouched + 1);
  assert.equal((await f.accept()).status, 200);
  assert.equal(f.updateCount(), 1);
  assert.equal(f.newlyAcceptedMessages(), 1);
});
test("an already accepted stale notification is cleaned without granting or notifying again", async () => {
  const f = fixture({ accepted: true });
  const res = await f.accept();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, alreadyAccepted: true });
  assert.equal(f.updateCount(), 0);
  assert.equal(f.newlyAcceptedMessages(), 0);
  assert.equal(f.pending(), 0);
});
test("temporary notification failure leaves accepted membership and the next retry cleans it once", async () => {
  const f = fixture({ cleanupFails: true });
  const failed = await f.accept();
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /Staff access was accepted/);
  assert.equal(f.db.event_co_organizers[0].accepted, true);
  assert.equal(f.pending(), 2);
  f.disableCleanupFailure();
  assert.equal((await f.accept()).status, 200);
  assert.equal(f.updateCount(), 1);
  assert.equal(f.newlyAcceptedMessages(), 1);
  assert.equal(f.pending(), 0);
});
test("profile lookup failure remains retriable and never broadens the deletion", async () => {
  const f = fixture({ accepted: true, profileReadFails: true });
  assert.equal((await f.accept()).status, 503);
  assert.equal(f.deleteCount(), 0);
  f.disableCleanupFailure();
  assert.equal((await f.accept()).status, 200);
  assert.equal(f.pending(), 0);
});
test("a missing actor or recipient mapping is not a successful cleanup; exact mapping restoration allows retry", async () => {
  for (const missingAccount of ["invitee", "inviter"]) {
    const f = fixture();
    const index = f.db.users.findIndex(row => row.auth_id === missingAccount);
    const [missing] = f.db.users.splice(index, 1);
    const unmatched = await f.accept();
    assert.equal(unmatched.status, 409);
    assert.match((await unmatched.json()).error, /accepted.*couldn’t be safely matched/);
    assert.equal(f.db.event_co_organizers[0].accepted, true);
    assert.equal(f.pending(), 2);
    assert.equal(f.deleteCount(), 0);
    assert.equal(f.newlyAcceptedMessages(), 0);

    f.db.users.push(missing);
    const matched = await f.accept();
    assert.equal(matched.status, 200);
    assert.deepEqual(await matched.json(), { ok: true, alreadyAccepted: true });
    assert.equal(f.pending(), 0);
    assert.equal(f.updateCount(), 1);
    assert.equal(f.newlyAcceptedMessages(), 0);
  }
});
test("a legacy membership without inviter binding never broadens deletion or reports success", async () => {
  const f = fixture({ accepted: true });
  f.db.event_co_organizers[0].invited_by = null;
  assert.equal((await f.accept()).status, 409);
  assert.equal(f.deleteCount(), 0);
  assert.equal(f.pending(), 2);
  assert.equal(f.updateCount(), 0);
});
test("signed-out, wrong recipient and membership lookup errors never clear activity or grant access", async () => {
  const f = fixture();
  assert.equal((await f.accept(null)).status, 401);
  assert.equal((await f.accept("inviter")).status, 403);
  assert.equal(f.pending(), 2);
  assert.equal(f.updateCount(), 0);
  assert.equal(f.deleteCount(), 0);
  const broken = fixture({ memberReadFails: true });
  assert.equal((await broken.accept()).status, 503);
  assert.equal(broken.deleteCount(), 0);
});
test("a concurrent change to the offered role cannot accept, clean or notify", async () => {
  const f = fixture({ acceptRaces: true });
  assert.equal((await f.accept()).status, 409);
  assert.equal(f.db.event_co_organizers[0].accepted, false);
  assert.equal(f.pending(), 2);
  assert.equal(f.deleteCount(), 0);
  assert.equal(f.newlyAcceptedMessages(), 0);
});
