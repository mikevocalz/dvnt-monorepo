const { readFileSync } = require("node:fs");
const { stripTypeScriptTypes } = require("node:module");
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Run the actual HTTP handler; replace only network/platform dependencies.
const source = readFileSync(require.resolve("./index.ts"), "utf8")
  .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];\n/gm, "");
const wire = new Function("Deno", "createClient", "verifySession", "corsHeaders",
  "optionsResponse", "checkRateLimit", "fetch", "console", "webpush", stripTypeScriptTypes(source));
const inviteId = "11111111-2222-4333-8444-555555555555";
const exact = { recipient_id: 10, actor_id: 20, type: "event_co_organizer_invited", entity_type: "event", entity_id: inviteId };

function fixture({ accepted = false, cleanupFails = false, acceptRaces = false,
  memberReadFails = false, profileReadFails = false, tokens = [], keys = true, expoStatus = 200, webFailure = false } = {}) {
  const db = {
    event_co_organizers: [{ id: inviteId, event_id: 11, user_id: "invitee", invited_by: "inviter", role: "editor", accepted }],
    users: [{ auth_id: "invitee", id: 10, username: "guest" }, { auth_id: "inviter", id: 20, username: "host" }],
    notifications: [
      exact, { ...exact },
      { ...exact, recipient_id: 99 }, { ...exact, actor_id: 99 },
      { ...exact, entity_id: "another-invite" }, { ...exact, entity_type: "room" },
      { ...exact, type: "like" },
    ],
    push_tokens: tokens,
    web_push_keys: keys ? [{ id: 1, public_key: "fixture-pub", private_key: "fixture-priv", subject: "mailto:fixture@example.invalid" }] : [],
    events: [{ id: 11, host_id: "inviter", title: "Fixture event" }],
  };
  let deletes = 0, updates = 0, handler;
  const pushes = [], warnings = [];
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
      ilike(k, v) { conditions.push([k, v]); return this; },
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
    () => ({ allowed: true }), async (url, init) => {
      assert.equal(url, "https://exp.host/--/api/v2/push/send");
      pushes.push({ channel: "expo", messages: JSON.parse(init.body) });
      return new Response(null, { status: expoStatus });
    }, { warn(message) { warnings.push(message); }, error() {} }, {
      async sendNotification(subscription, payload, options) {
        pushes.push({ channel: "web", subscription, payload: JSON.parse(payload), options });
        if (webFailure) throw Error("provider failure with redacted fixture endpoint");
      },
    });
  const unrelated = () => db.notifications.filter(row => ![exact.type, "event_co_organizer_accepted"].includes(row.type) ||
    row.recipient_id !== 10 || row.actor_id !== 20 || row.entity_id !== inviteId || row.entity_type !== "event");
  const untouched = unrelated().length;
  return {
    db, unrelated, untouched, pushes, warnings,
    invite: (user = "inviter") => handler(new Request("https://fixture.invalid/invite-co-organizer", {
      method: "POST", headers: { "x-fixture-session": user },
      body: JSON.stringify({ action: "invite", event_id: 11, username: "guest", role: "editor" }),
    })),
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

const subscription=(endpoint)=>JSON.stringify({endpoint,keys:{p256dh:"A".repeat(87),auth:"B".repeat(22)}});
const webToken={user_id:10,platform:"web",token:subscription("https://web.push.apple.com/fixture")};
const nativeToken={user_id:10,platform:"ios",token:"ExponentPushToken[fixture_ios]"};

test("staff invitation separates native Expo and valid browser VAPID subscriptions", async () => {
  const f=fixture({tokens:[
    webToken,nativeToken,
    {user_id:10,platform:"web",token:subscription("https://fcm.googleapis.com/fcm/send/fixture")},
    {user_id:10,platform:"web",token:subscription("https://updates.push.services.mozilla.com/wpush/v2/fixture")},
    {user_id:10,platform:"web",token:subscription("https://fcm.googleapis.com.evil.invalid/fixture")},
    {user_id:10,platform:"web",token:subscription("https://user@web.push.apple.com/fixture")},
    {user_id:10,platform:"web",token:subscription("https://web.push.apple.com:8443/fixture")},
    {user_id:10,platform:"web",token:subscription("https://127.0.0.1/fixture")},
    {user_id:10,platform:"web",token:"{}"},
    {user_id:10,platform:"ios_voip",token:"ExpoPushToken[not-a-staff-destination]"},
    {user_id:99,platform:"ios",token:"ExpoPushToken[other-account]"},
  ]});
  assert.equal((await f.invite()).status,200);
  assert.equal(f.db.event_co_organizers[0].accepted,false);
  const expo=f.pushes.filter(row=>row.channel==="expo");
  assert.equal(expo.length,1);
  assert.equal(expo[0].messages.length,1);
  assert.equal(expo[0].messages[0].to,nativeToken.token);
  assert.equal(expo[0].messages[0].data.url,"https://dvntapp.live/e/11");
  assert.equal(expo[0].messages[0].data.type,"event_co_organizer_invited");
  const web=f.pushes.filter(row=>row.channel==="web");
  assert.deepEqual(web.map(row=>new URL(row.subscription.endpoint).hostname),
    ["web.push.apple.com","fcm.googleapis.com","updates.push.services.mozilla.com"]);
  for(const row of web){
    assert.equal(row.payload.title,"Event staff invite");
    assert.equal(row.payload.data.type,"event_co_organizer_invited");
    assert.equal(row.payload.data.entityId,inviteId);
    assert.equal(row.payload.data.url,"/feed/activity");
    assert.equal(row.options.vapidDetails.privateKey,"fixture-priv");
  }
  assert.equal(f.warnings.length,0);
});

test("one push channel cannot suppress the other or undo a staff invitation", async () => {
  for(const settings of [{keys:false},{webFailure:true},{expoStatus:503}]){
    const f=fixture({tokens:[webToken,nativeToken],...settings});
    const original=f.pending();
    assert.equal((await f.invite()).status,200);
    assert.equal(f.pending(),original+1);
    assert.equal(f.pushes.some(row=>row.channel==="expo"),true);
    assert.equal(f.pushes.some(row=>row.channel==="web"),settings.keys!==false);
    assert.deepEqual(f.warnings,["[invite-co-organizer] push failed (non-fatal)"]);
  }
  const f=fixture({tokens:[webToken,nativeToken]});
  assert.equal((await f.invite("other")).status,403);
  assert.deepEqual(f.pushes,[]);
});
