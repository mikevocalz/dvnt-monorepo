#!/usr/bin/env node
// Real sharing hook, API, mutation/cache, reload mapping and playback attribution.
// Auth/network/player-timing edges are offline. No production writes or DMs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildFixture,
  resolve,
} = require("./story-share-attribution-fixture.cjs");
(async () => {
  const { Window } = await import(resolve("happy-dom"));
  const window = new Window({ url: "https://fixture.invalid" });
  Object.assign(global, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-attribution-dom-"));
  let app, f;
  try {
    await buildFixture({ outfile: path.join(dir, "fixture.cjs") });
    ({ f } = require(path.join(dir, "fixture.cjs")));
    const flush = async (run) =>
      f.act(async () => {
        await run?.();
        await new Promise((r) => setTimeout(r, 5));
      });
    const node = document.createElement("div");
    document.body.append(node);
    app = f.mount(node);
    const source = {
      type: "post",
      id: "11",
      author: {
        id: "9",
        username: "original",
        name: "Original Author",
        avatar: "https://fixture.invalid/original.jpg",
      },
      caption: "Canonical text from the original post",
    };
    const eventSource = {
      ...source,
      type: "event",
      id: "22",
      title: "Canonical event title",
      caption: "Event description",
    };
    const response = (sharedSource = source, mediaUrl = "") => ({
      data: {
        ok: true,
        data: {
          story: {
            id: "101",
            authorId: "1",
            author: { username: "publisher", avatar: "publisher.jpg" },
            mediaUrl,
            mediaType: "image",
            sharedSource,
          },
        },
      },
      error: null,
    });
    const calls = [];
    let respond = () => response();
    global.__storyInvoke = async (name, args) => {
      calls.push({ name, ...args });
      return respond(args);
    };
    await flush(() => app.render());
    for (const event of [
      { visibility: "private" },
      { visibility: "link_only" },
      { status: "draft" },
      { status: "cancelled" },
      { status: "suspended" },
      { isHidden: true },
      { publishAt: "2999-01-01T00:00:00Z" },
    ]) {
      await flush(() =>
        app.render({
          id: "22",
          visibility: "public",
          status: "active",
          ...event,
        }),
      );
      assert.equal(
        document.querySelector("button"),
        null,
        "ineligible event has no story-share affordance",
      );
    }
    await flush(() => app.render());
    let release;
    respond = () => new Promise((r) => (release = r));
    await flush(() => {
      document.querySelector("button").click();
      document.querySelector("button").click();
    });
    assert.equal(calls.length, 1);
    assert.equal(document.querySelector("button").disabled, true);
    assert.equal(
      f.client.getQueryData(f.storyKeys.list()),
      undefined,
      "no ghost published share before atomic server success",
    );
    assert.deepEqual(calls[0].body.sharedSource, { type: "event", id: "22" });
    assert.deepEqual(Object.keys(calls[0].body).sort(), [
      "expectedViewerId",
      "operationId",
      "sharedSource",
      "visibility",
    ]);
    assert.match(
      calls[0].body.operationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    await flush(() =>
      release(response(eventSource, "https://fixture.invalid/flyer.jpg")),
    );
    assert.equal(global.__shared, 1);
    assert.equal(global.__toasts.at(-1)[0], "success");
    const cached = f.client.getQueryData(f.storyKeys.list());
    assert.deepEqual(cached[0].items[0].sharedSource, eventSource);
    assert.equal(cached[0].items[0].url, "https://fixture.invalid/flyer.jpg");
    assert.equal(cached[0].items[0].id, "101");
    // Failed/ambiguous publishes retain their operation UUID. Retry, remount and
    // double-click all use one server idempotency identity for this account.
    respond = () => ({ error: new Error("response lost") });
    await flush(() => f.share({ type: "post", id: "11" }));
    const failedId = calls.at(-1).body.operationId;
    assert.equal(global.__toasts.at(-1)[0], "error");
    assert.deepEqual(f.client.getQueryData(f.storyKeys.list()), cached);
    await flush(() => app.unmount());
    f.client.clear();
    delete require.cache[require.resolve(path.join(dir, "fixture.cjs"))];
    ({ f } = require(path.join(dir, "fixture.cjs")));
    global.__storyInvoke = async (name, args) => {
      calls.push({ name, ...args });
      return respond(args);
    };
    app = f.mount(node);
    await flush(() => app.render());
    respond = () => response();
    await flush(() => f.share({ type: "post", id: "11" }));
    assert.equal(
      calls.at(-1).body.operationId,
      failedId,
      "retry after JavaScript reload reuses session-persisted UUID",
    );
    const afterRetry = f.client.getQueryData(f.storyKeys.list());
    assert.equal(
      afterRetry[0].items.length,
      1,
      "replayed story does not duplicate cached segment",
    );
    assert.deepEqual(afterRetry[0].items[0].sharedSource, source);
    assert.equal(
      afterRetry[0].items[0].url,
      undefined,
      "text share keeps null canonical media",
    );
    assert.equal(
      afterRetry[0].items[0].type,
      "text",
      "native uses its existing text renderer, not an undefined media URL",
    );
    assert.match(afterRetry[0].items[0].text, /@original/);

    // Reload actual persisted JSON from the database and retain per-segment author.
    global.__storyDb = (table) => ({
      error: null,
      data:
        table === "stories"
          ? [
              {
                id: 102,
                author_id: "auth1",
                created_at: "2026-10-20T20:00:00Z",
                visibility: "public",
                shared_source: eventSource,
                media: {
                  url: "https://fixture.invalid/flyer.jpg",
                  mime_type: "image/jpeg",
                },
              },
              {
                id: 101,
                author_id: "auth1",
                created_at: "2026-10-20T19:00:00Z",
                visibility: "public",
                shared_source: source,
                media: null,
              },
            ]
          : table === "users"
            ? [
                {
                  id: 1,
                  auth_id: "auth1",
                  username: "publisher",
                  avatar: { url: "publisher.jpg" },
                },
                {
                  id: 9,
                  username: "original",
                  first_name: "Original",
                  last_name: "Author",
                  avatar: { url: source.author.avatar },
                },
              ]
            : [],
    });
    const reloaded = await f.storiesApi.getStories();
    assert.equal(reloaded[0].items.length, 2);
    assert.equal(reloaded[0].items[0].type, "text");
    assert.match(reloaded[0].items[0].text, /Canonical text/);
    assert.deepEqual(reloaded[0].items[0].sharedSource, source);
    const group = f.toStoryViewerGroup(reloaded[0]);
    assert.equal(group.segments[0].isSourceCard, true);
    assert.equal(group.segments[0].url, f.SHARED_STORY_BACKDROP);
    assert.equal(group.segments[1].sharedSource.author.id, "9");
    assert.equal(
      f.parseStorySharedSource({
        ...source,
        author: { username: "publisher" },
      }),
      undefined,
      "bad JSON cannot become publisher attribution",
    );
    await flush(() =>
      f.useAuthStore.setState({
        user: { id: "2", username: "viewer", authId: "auth2" },
      }),
    );
    await flush(() => f.open(reloaded));
    const attribution = () =>
      document.querySelector('[aria-label="Shared post by @original"]');
    assert.ok(attribution());
    assert.match(attribution().textContent, /Canonical text/);
    assert.match(attribution().textContent, /Original Author/);
    const profile = attribution().querySelector("a");
    assert.equal(profile.getAttribute("href"), "/profile/original");
    assert.equal(
      profile.querySelector("img").getAttribute("src"),
      source.author.avatar,
    );
    await flush(() =>
      profile.querySelector("img").dispatchEvent(new window.Event("error")),
    );
    assert.equal(profile.querySelector("img").style.visibility, "hidden");
    await flush(() => profile.click());
    assert.equal(global.__routes.at(-1), "/profile/original");
    assert.equal(global.__advances, 0);
    assert.equal(f.useStoryViewerStore.getState().navigationClose, true);
    await flush(() => f.open(reloaded));
    await flush(() =>
      document.querySelector('a[href="/feed/post/11"]').click(),
    );
    assert.equal(global.__routes.at(-1), "/feed/post/11");
    await flush(() => f.open(reloaded));
    await flush(() => global.__player.onStoryChange(1));
    assert.ok(
      document.querySelector('[aria-label="Shared event by @original"]'),
    );
    await flush(() => document.querySelector('a[href="/e/22"]').click());
    assert.equal(global.__routes.at(-1), "/e/22");
    assert.equal(global.__advances, 0);

    const originalDb = global.__storyDb;
    global.__storyDb = (table) => {
      const result = originalDb(table);
      return table === "users"
        ? {
            ...result,
            data: result.data.map((author) =>
              author.id === 9
                ? { ...author, username: "renamed", first_name: "Updated" }
                : author,
            ),
          }
        : result;
    };
    const renamed = await f.storiesApi.getStories();
    assert.equal(
      renamed[0].items[0].sharedSource.author.username,
      "renamed",
      "stable source-author ID rehydrates renamed profile",
    );
    await flush(() => f.open(renamed));
    assert.equal(document.querySelector('a[href="/profile/original"]'), null);
    assert.ok(document.querySelector('a[href="/profile/renamed"]'));
    global.__storyDb = (table) => {
      const result = originalDb(table);
      return table === "users"
        ? { ...result, data: result.data.filter((author) => author.id !== 9) }
        : result;
    };
    const deleted = await f.storiesApi.getStories();
    await flush(() => f.open(deleted));
    assert.ok(
      document.querySelector(
        '[aria-label="Original author profile unavailable"]',
      ),
    );
    assert.equal(
      document.querySelector('a[href="/profile/original"]'),
      null,
      "missing author cannot navigate a reassigned old handle",
    );
    await flush(() => f.close());

    // Deferred admission, token refresh, A→B→A, late success and unmount are all
    // pinned to the intent's account and lifetime, never a new viewer's cache.
    await flush(() =>
      f.useAuthStore.setState({
        user: { id: "1", username: "publisher", authId: "auth1" },
      }),
    );
    global.__deferGate = true;
    const beforeGate = calls.length;
    await flush(() => f.share({ type: "post", id: "33" }));
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "2", authId: "auth2" } });
      f.useAuthStore.setState({ user: { id: "1", authId: "auth1" } });
      global.__gate();
    });
    assert.equal(
      calls.length,
      beforeGate,
      "A→B→A invalidates deferred authorization",
    );
    global.__deferGate = false;
    let resolveToken;
    global.__token = () => new Promise((r) => (resolveToken = r));
    await flush(() => f.share({ type: "post", id: "34" }));
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "2", authId: "auth2" } });
      resolveToken("wrong-account-token");
    });
    assert.equal(
      calls.length,
      beforeGate,
      "account switch during token refresh does not send",
    );
    global.__token = async () => "token";
    respond = () => new Promise((r) => (release = r));
    await flush(() =>
      f.useAuthStore.setState({ user: { id: "1", authId: "auth1" } }),
    );
    await flush(() => f.share({ type: "post", id: "35" }));
    const newCache = [{ id: "new-viewer", userId: "2", items: [] }];
    const toastCount = global.__toasts.length;
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "2", authId: "auth2" } });
      f.client.setQueryData(f.storyKeys.list(), newCache);
      release(response());
    });
    assert.deepEqual(f.client.getQueryData(f.storyKeys.list()), newCache);
    assert.equal(global.__toasts.length, toastCount);
    global.__token = () => new Promise((r) => (resolveToken = r));
    await flush(() => f.share({ type: "post", id: "36" }));
    const beforeUnmount = calls.length;
    await flush(() => app.unmount());
    app = null;
    await flush(() => resolveToken("token"));
    assert.equal(
      calls.length,
      beforeUnmount,
      "unmount before token resolves never publishes",
    );
    assert.ok(
      calls.every((call) => call.name === "create-story"),
      "no client DM or conversation creation",
    );
    console.log(
      "PASS story attribution DOM: real event action eligibility, source-only payload, single-flight, canonical cache, failed/retried UUID, reload/text media, per-segment author/profile/source links, account epochs and unmount isolation",
    );
  } finally {
    if (app) await f.act(async () => app.unmount());
    f?.client.clear();
    await window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
