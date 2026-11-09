const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../apps/mobile/supabase/functions");
const secret = "PRIVATE_SOURCE_SENTINEL";
function fixture(options = {}) {
  const author = {
    id: 2,
    auth_id: "author",
    username: "author",
    is_private: options.private === true,
    avatar: { url: "avatar" },
  };
  const post = {
    id: 101,
    author_id: 2,
    author,
    visibility: "public",
    is_nsfw: options.spicy !== false,
    content: secret,
    post_kind: "text",
    created_at: "2026-11-09",
    location: secret,
    text_theme: secret,
    media: [{ type: "image", url: secret, _order: 0 }],
    post_text_slides: [{ id: 1, content: secret, slide_index: 0 }],
    future_secret: secret,
  };
  const tables = {
    users: [{ id: 1, auth_id: "viewer", username: "viewer" }, author],
    posts: [post],
    follows: options.follow ? [{ follower_id: 1, following_id: 2 }] : [],
    follow_requests: options.approved
      ? [{ follower_id: 1, following_id: 2, status: "approved" }]
      : [],
    blocks: options.block ? [{ blocker_id: 2, blocked_id: 1 }] : [],
    user_settings: [
      {
        auth_id: "author",
        settings: { privacy: { privateAccount: options.preference ?? false } },
      },
    ],
    identity_verifications: options.minor
      ? [{ user_id: "viewer", date_of_birth: "2020-01-01" }]
      : [],
    verified_admission_policy: [
      { id: 1, denylist: options.denied ? ["viewer"] : [] },
    ],
    bookmarks: [{ user_id: 1, post_id: 101 }],
    liked_activity_history: [
      { id: 1, user_id: 1, entity_type: "post", entity_id: 101 },
    ],
    posts_media: [{ _parent_id: 101, type: "image", url: secret }],
    post_text_slides: [
      { post_id: 101, id: 1, slide_index: 0, content: secret },
    ],
    notifications: [
      {
        id: 1,
        recipient_id: 1,
        type: "like",
        entity_type: "post",
        entity_id: 101,
        entity_payload: { body: secret },
        sender: author,
      },
    ],
  };
  const calls = [];
  const db = {
    rpc(name, args) {
      assert.equal(name, "post_relationship_access");
      const pref = options.preference ?? false;
      const isPrivate = options.private === true || (pref !== false && pref !== "false");
      return Promise.resolve({
        data: args.p_authors.map(id => ({ author_id: id, is_private: isPrivate,
          is_following: args.p_viewer != null && tables.follows.some(f => f.follower_id === args.p_viewer && f.following_id === id) && (!isPrivate || tables.follow_requests.some(f => f.following_id === id && f.status === "approved") || !!options.legacy),
          is_blocked: args.p_viewer != null && !!options.block, enforcement_ready: options.ready !== false })),
        error: options.notReady || ["users", "follows", "follow_requests", "blocks", "user_settings"].includes(options.errorTable)
          ? { message: "preservation unavailable" } : null,
      });
    },
    from(table) {
      calls.push(table);
      let rows = tables[table] || [],
        single = false,
        start = 0,
        end = Infinity;
      const query = {
        select() {
          return query;
        },
        eq(k, v) {
          rows = rows.filter((r) => String(r[k]) === String(v));
          return query;
        },
        neq(k, v) {
          rows = rows.filter((r) => String(r[k]) !== String(v));
          return query;
        },
        in(k, vs) {
          rows = rows.filter((r) => vs.map(String).includes(String(r[k])));
          return query;
        },
        gt(k, v) {
          rows = rows.filter((r) => r[k] > v);
          return query;
        },
        gte() {
          return query;
        },
        is() {
          return query;
        },
        not() {
          return query;
        },
        or(expr) {
          if (expr.includes("is_nsfw"))
            rows = rows.filter((r) => r.is_nsfw !== true);
          return query;
        },
        order() {
          return query;
        },
        limit(n) {
          end = n - 1;
          return query;
        },
        range(a, b) {
          start = a;
          end = b;
          return query;
        },
        single() {
          single = true;
          return query;
        },
        maybeSingle() {
          single = true;
          return query;
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: single ? rows[0] || null : rows.slice(start, end + 1),
            count: rows.length,
            error:
              options.errorTable === table
                ? { message: "lookup unavailable" }
                : null,
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  let handler;
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const requireMock = (spec) => {
      if (spec.startsWith("https:")) return { createClient: () => db };
      if (spec.endsWith("verify-session.ts"))
        return {
          verifySession: async () =>
            options.guest ? null : options.owner ? "author" : "viewer",
          verifySessionDetailed: async () => ({
            ok: true,
            userId: options.owner ? "author" : "viewer",
          }),
          CORS_HEADERS: {},
          optionsResponse: () => new Response(null, { status: 204 }),
          jsonResponse: (body) => new Response(JSON.stringify(body)),
          errorResponse: (message, status = 500) =>
            new Response(JSON.stringify({ error: message }), { status }),
        };
      if (spec.endsWith("resolve-user.ts"))
        return {
          resolveOrProvisionUser: async () => ({ id: options.owner ? 2 : 1 }),
        };
      if (spec.endsWith("verified-admission.ts")) return { resolveVerifiedAdmission: async () => ({ state: "allowed" }) };
      if (spec.endsWith("rate-limit.ts")) return { checkRateLimit: () => ({ allowed: true }), WRITE_LIMIT: {} };
      if (spec.endsWith("sentry.ts")) return { withSentry: (_, fn) => fn };
      return load(path.resolve(path.dirname(file), spec));
    };
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      {
        exports,
        require: requireMock,
        Response,
        Request,
        Date,
        Set,
        Map,
        console: { log() {}, warn() {}, error() {} },
        Deno: {
          env: { get: () => "fixture" },
          serve: (fn) => {
            handler = fn;
          },
        },
      },
      { filename: file },
    );
    return exports;
  }
  return {
    db,
    post,
    calls,
    tables,
    projection: () =>
      load(path.join(root, "_shared/post-access.ts")).projectVisiblePosts,
    async run(name, body = {}) {
      load(path.join(root, name, "index.ts"));
      return handler(
        new Request("https://fixture.invalid", {
          method: "POST",
          headers: {
            Authorization: "Bearer fixture",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
    },
  };
}
for (const [label, options, expected] of [
  ["public nonfollower", {}, "locked"],
  ["staged compatible private read retains old visibility", { ready: false, private: true }, "visible"],
  ["staged compatible spicy read retains old visibility", { ready: false }, "visible"],
  ["staged mode still respects block", { ready: false, block: true }, "hidden"],
  ["staged mode still respects age", { ready: false, minor: true }, "hidden"],
  ["public follower", { follow: true }, "visible"],
  ["private retained legacy follower", { private: true, follow: true, legacy: true }, "visible"],
  ["legacy cannot replace live follow", { private: true, legacy: true }, "locked"],
  ["legacy still respects block", { private: true, follow: true, legacy: true, block: true }, "hidden"],
  ["legacy still respects age", { private: true, follow: true, legacy: true, minor: true }, "hidden"],
  ["legacy still respects admission", { private: true, follow: true, legacy: true, denied: true }, "hidden"],
  ["missing readiness fails closed", { private: true, follow: true, legacy: true, notReady: true }, "hidden"],
  ["private raw follower", { private: true, follow: true }, "locked"],
  [
    "private approved follower",
    { private: true, follow: true, approved: true },
    "visible",
  ],
  [
    "private approved without follow",
    { private: true, approved: true },
    "locked",
  ],
  ["settings private", { preference: true, follow: true }, "locked"],
  ["malformed privacy", { preference: "garbage", follow: true }, "locked"],
  ["minor follower", { minor: true, follow: true }, "hidden"],
  ["denied follower", { denied: true, follow: true }, "hidden"],
  ["guest", { guest: true }, "hidden"],
  [
    "blocked approved",
    { private: true, follow: true, approved: true, block: true },
    "hidden",
  ],
  [
    "failed privacy lookup",
    { errorTable: "user_settings", follow: true },
    "hidden",
  ],
  [
    "failed relationship lookup",
    { errorTable: "follows", follow: true },
    "hidden",
  ],
  [
    "failed age lookup",
    { errorTable: "identity_verifications", follow: true },
    "hidden",
  ],
  [
    "failed policy lookup",
    { errorTable: "verified_admission_policy", follow: true },
    "hidden",
  ],
  ["owner", { owner: true, minor: true }, "visible"],
  ["private safe nonfollower", { private: true, spicy: false }, "hidden"],
  [
    "private safe approved",
    { private: true, spicy: false, follow: true, approved: true },
    "visible",
  ],
])
  test(label, async () => {
    const f = fixture(options);
    const rows = await f.projection()(
      f.db,
      [f.post],
      {
        authId: options.guest ? null : options.owner ? "author" : "viewer",
        userId: options.guest ? null : options.owner ? 2 : 1,
      },
      { placeholders: true },
    );
    if (expected === "hidden") assert.equal(rows.length, 0);
    else {
      assert.equal(rows.length, 1);
      assert.equal(rows[0].isSpicyLocked, expected === "locked");
      assert.equal(
        JSON.stringify(rows).includes(secret),
        expected === "visible",
      );
    }
  });
for (const [name, body] of [
  ["get-posts", { mode: "feed", includeNsfw: true }],
  ["get-posts", { mode: "detail", postId: 101, viewerUserId: 2 }],
  ["get-posts", { mode: "profile", userId: 2 }],
  ["bootstrap-feed", { include_nsfw: true }],
  ["bootstrap-profile", { user_id: 2, include_nsfw: true }],
  ["get-bookmarks", { withPosts: true }],
  ["get-liked-activity", {}],
  ["get-text-post-slides", { postIds: [101] }],
  ["bootstrap-notifications", {}],
])
  test(`${name} actual response denies originals until followed`, async () => {
    for (const follow of [false, true]) {
      const f = fixture({ follow });
      const response = await f.run(name, body);
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.equal(text.includes(secret), follow, `${name} response: ${text}`);
    }
  });
test("detail never reveals another author nonpublic post", async () => {
  const f = fixture({ follow: true });
  f.post.visibility = "private";
  const response = await f.run("get-posts", { mode: "detail", postId: 101 });
  assert.deepEqual((await response.json()).posts, []);
});
test("direct detail cannot spoof identity in body", async () => {
  const f = fixture({ guest: true });
  const response = await f.run("get-posts", {
    mode: "detail",
    postId: 101,
    userId: 2,
    authId: "author",
  });
  assert.deepEqual((await response.json()).posts, []);
});
test("revocation rechecks database, no cached authorization", async () => {
  const f = fixture({ follow: true });
  const project = f.projection();
  assert.equal(
    (
      await project(
        f.db,
        [f.post],
        { authId: "viewer", userId: 1 },
        { placeholders: true },
      )
    )[0].isSpicyLocked,
    false,
  );
  f.tables.follows = [];
  assert.equal(
    (
      await project(
        f.db,
        [f.post],
        { authId: "viewer", userId: 1 },
        { placeholders: true },
      )
    )[0].isSpicyLocked,
    true,
  );
});
test("ineligible text slide read never queries protected slides", async () => {
  const f = fixture({ minor: true, follow: true });
  await f.run("get-text-post-slides", { postIds: [101] });
  assert.equal(f.calls.includes("post_text_slides"), false);
});

test('comment threads deny locked post before fetching comments', async () => {
  const f = fixture();
  const response = await f.run('get-post-comments', { postId: 101, rootCommentId: 1 });
  assert.equal(response.status, 403);
  assert.equal(f.calls.includes('comments'), false);
  assert.equal((await response.text()).includes(secret), false);
});
test('comment threads remain accessible to authorized followers', async () => {
  const f = fixture({ follow: true });
  const response = await f.run('get-post-comments', { postId: 101 });
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.calls.includes('comments'), true);
});

test('comment creation refuses locked parent before reply or insert lookup', async () => {
  const f = fixture();
  const response = await f.run('add-comment', { postId: 101, content: 'Hello', parentId: 9 });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'forbidden');
  assert.equal(f.calls.includes('comments'), false);
});

test('settings read failure never becomes Public defaults', async () => {
  const source = fs.readFileSync(path.resolve(root, '../../../../packages/app/lib/hooks/use-user-settings.ts'), 'utf8');
  const tree = ts.createSourceFile('use-user-settings.ts', source, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'requestUserSettings');
  assert.ok(fn, 'execute the production settings request helper');
  for (const result of [{ error: { message: 'offline' } }, { data: { ok: false, error: { message: 'denied' } } }, {}]) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fn.getText(tree) + '\nexports.fetch = requestUserSettings;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, requireBetterAuthToken: async () => 'fixture', supabase: { functions: { invoke: async () => result } },
    });
    await assert.rejects(exports.fetch({ assertCurrent() {}, authId: 'fixture-owner' }));
  }
});
