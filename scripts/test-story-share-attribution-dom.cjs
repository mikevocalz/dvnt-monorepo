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
                expires_at: new Date(Date.now() + 3600000).toISOString(),
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
                expires_at: new Date(Date.now() + 3600000).toISOString(),
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
    assert.deepEqual(group.segments[0].sharedSource, source);
    assert.deepEqual(group.segments[1].sharedSource, eventSource);
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
    for (const [storyId, expectedSource] of [["101", source], ["102", eventSource]]) {
      const playback = await f.storiesApi.getSharedStoryForPlayback(storyId, expectedSource, "2", () => true);
      assert.deepEqual(playback.sharedSource, expectedSource, "fresh playback preserves every source and author field");
    }
    await flush(() => f.open(reloaded));
    const attribution = () =>
      document.querySelector('[aria-label="Shared post by @original"]');
    assert.ok(attribution());
    assert.match(document.querySelector('[aria-label="Shared post content"]').textContent, /Canonical text/);
    assert.doesNotMatch(attribution().textContent, /Canonical text/);
    assert.ok(attribution().closest("[data-story-footer]"));
    assert.equal(attribution().querySelector('a[href="/feed/post/11"]').textContent.trim(), "View Post");
    assert.equal(document.querySelectorAll('button[aria-label^="React "]').length, 7);
    assert.equal(attribution().textContent.trim(), "View Post", "only the source action is visible to another viewer");
    assert.equal(attribution().querySelectorAll("a, button").length, 1);
    assert.equal(attribution().querySelector("img"), null, "no footer avatar");
    assert.equal(attribution().querySelector('a[href^="/profile/"]'), null, "no third action or hidden profile link");
    assert.equal(attribution().matches("[data-story-source-actions]"), true);
    assert.doesNotMatch(attribution().className, /rounded|border|bg-|backdrop|p-3/, "actions have no surrounding card presentation");
    await flush(() => attribution().click());
    assert.equal(global.__advances, 0, "empty footer space does not advance the story");
    await flush(() =>
      document.querySelector('a[href="/feed/post/11"]').click(),
    );
    assert.equal(global.__routes.at(-1), "/feed/post/11");
    assert.equal(global.__advances, 0);
    assert.equal(f.useStoryViewerStore.getState().navigationClose, true);
    await flush(() => f.open(reloaded));
    await flush(() => global.__player.onStoryChange(1));
    assert.ok(
      document.querySelector('[aria-label="Shared event by @original"]'),
    );
    for (let i = 0; i < 100 && !document.querySelector('a[href="/events/current-event-title"]'); i++) await flush();
    assert.equal(document.querySelector('a[href="/events/current-event-title"]').textContent.trim(), "View Event");
    assert.equal(document.querySelector('[data-story-source-actions]').textContent.trim(), "View Event", "event footer has no author or title row");
    assert.equal(document.querySelector('[aria-label="Shared event content"]'), null, "media events do not duplicate their flyer with a text card");
    await flush(() => document.querySelector('a[href="/events/current-event-title"]').click());
    assert.equal(global.__routes.at(-1), "/events/current-event-title");
    assert.equal(global.__advances, 0);

    // Viewers stays owner-only, shares an action row with the source link, and
    // cannot remain open after the owner changes or signs out.
    await flush(() => f.useAuthStore.setState({ user: { id: "1", authId: "auth1" } }));
    await flush(() => f.open(reloaded));
    const viewers = () => document.querySelector('button[aria-label="See who viewed this story"]');
    assert.ok(viewers());
    assert.equal(viewers().parentElement, attribution());
    assert.equal(attribution().querySelectorAll("a, button").length, 2, "owner has exactly two source-footer actions");
    assert.equal(attribution().firstElementChild, viewers());
    assert.equal(attribution().textContent.replace(/\s+/g, " ").trim(), "ViewersView Post");
    assert.equal(viewers().nextElementSibling.textContent.trim(), "View Post");
    assert.equal(document.querySelector('input[aria-label^="Reply to "]'), null);
    await flush(() => viewers().click());
    assert.equal(global.__viewersSheet.open, true);
    assert.equal(global.__viewersSheet.storyId, "101");
    assert.equal(global.__player.paused, true);
    await flush(() => global.__viewersSheet.onClose());
    assert.equal(global.__viewersSheet.open, false);
    assert.equal(global.__player.paused, false);
    await flush(() => global.__player.onStoryChange(1));
    await flush(() => viewers().click());
    assert.equal(global.__viewersSheet.storyId, "102");
    await flush(() => f.useAuthStore.setState({ user: { id: "2", authId: "auth2" } }));
    assert.equal(viewers(), null);
    assert.equal(global.__viewersSheet.open, false);
    await flush(() => f.useAuthStore.setState({ user: null }));
    assert.equal(viewers(), null);
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await flush(() => f.useAuthStore.setState({ user: { id: "2", authId: "auth2" } }));

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
    assert.equal(document.querySelector('a[href="/profile/renamed"]'), null);
    assert.equal(document.querySelector('[data-story-source-actions]').getAttribute("aria-label"), "Shared post by @renamed", "fresh source identity remains accessible without a visible profile row");
    assert.equal(renamed[0].items[0].sharedSource.author.id, "9");
    assert.equal(renamed[0].items[0].sharedSource.author.name, "Updated Author");
    assert.equal(renamed[0].items[0].sharedSource.author.avatar, source.author.avatar);
    global.__storyDb = (table) => {
      const result = originalDb(table);
      return table === "users"
        ? { ...result, data: result.data.filter((author) => author.id !== 9) }
        : result;
    };
    const deleted = await f.storiesApi.getStories();
    await flush(() => f.open(deleted));
    assert.match(
      document.querySelector('[role="status"]').textContent,
      /no longer available/,
    );
    assert.equal(document.querySelector(".dvnt-story-viewer"), null);
    assert.equal(
      document.querySelector('a[href="/profile/original"]'),
      null,
      "missing author cannot navigate a reassigned old handle",
    );
    await flush(() => f.close());

    // Cached groups are only a selection list, never a playback authorization.
    global.__storyDb = originalDb;
    const rpc = global.__storyRpc;
    const rpcCalls = [];
    let pendingReads = [];
    const deferReads = () => {
      pendingReads = [];
      global.__storyRpc = (name, args) => {
        rpcCalls.push({ name, args });
        return new Promise((resolve) => pendingReads.push(resolve));
      };
    };
    const assertHidden = (status) => {
      assert.equal(
        document.querySelector(".dvnt-story-viewer"),
        null,
        "unauthorized shared media is never mounted",
      );
      assert.equal(
        document.querySelector('section[aria-label^="Shared "]'),
        null,
        "cached attribution is hidden until fresh authorization",
      );
      assert.equal(document.querySelector('a[href="/feed/post/11"]'), null);
      assert.equal(
        document.querySelector('input[aria-label^="Reply to "]'),
        null,
        "pending/denied source cannot be replied to",
      );
      assert.match(
        document.querySelector('[role="status"]').textContent,
        status,
      );
    };
    const granted = await rpc("get_story_share_for_playback", {
      p_story_id: 101,
      p_expected_viewer_id: 2,
    });
    const freshMedia = {
      ...granted,
      data: {
        ...granted.data,
        media: {
          url: "https://fixture.invalid/fresh-authorized.jpg",
          mime_type: "image/jpeg",
        },
      },
    };
    deferReads();
    await flush(() => f.open(reloaded));
    assertHidden(/Checking/);
    assert.deepEqual(rpcCalls.at(-1), {
      name: "get_story_share_for_playback",
      args: { p_story_id: 101, p_expected_viewer_id: 2 },
    });
    await flush(() => pendingReads[0]({ data: null, error: null }));
    assertHidden(/no longer available/);

    // Even the exact same store group reference must obtain a new grant on reopen.
    const sameGroups = f.useStoryViewerStore.getState().groups;
    await flush(() => f.useStoryViewerStore.getState().openAt(sameGroups, 0));
    assertHidden(/Checking/);
    assert.equal(pendingReads.length, 2);
    await flush(() => pendingReads[1](freshMedia));
    assert.ok(attribution());
    assert.equal(global.__player.stories[0].url, freshMedia.data.media.url);
    assert.equal(
      global.__player.stories[1].url,
      f.SHARED_STORY_BACKDROP,
      "inactive cached event URL is never handed to the player",
    );
    await flush(() => global.__player.onStoryChange(1));
    assertHidden(/Checking/);
    assert.equal(rpcCalls.at(-1).args.p_story_id, 102);
    await flush(() =>
      pendingReads[2]({ data: null, error: { message: "RLS denied" } }),
    );
    assertHidden(/no longer available/);

    // A previous opening or A→B→A identity cannot grant the current visit.
    deferReads();
    await flush(() => f.open(reloaded));
    const firstVisit = pendingReads[0];
    await flush(() => {
      f.useAuthStore.setState({ user: { id: "1", authId: "auth1" } });
      f.useAuthStore.setState({ user: { id: "2", authId: "auth2" } });
    });
    assert.equal(
      pendingReads.length,
      2,
      "ABA starts a new authorization even when the final viewer ID matches",
    );
    await flush(() => firstVisit(freshMedia));
    assertHidden(/Checking/);
    await flush(() => pendingReads[1]({ data: null, error: null }));
    assertHidden(/no longer available/);
    await flush(() => f.open(reloaded));
    const closedVisit = pendingReads.at(-1);
    await flush(() => {
      f.close();
      closedVisit(freshMedia);
    });
    assert.equal(document.querySelector(".dvnt-story-viewer"), null);
    await flush(() => f.open(reloaded));
    assertHidden(/Checking/);
    await flush(() => pendingReads.at(-1)({ data: null, error: null }));
    assertHidden(/no longer available/);

    // The database actor, not just the UI ID, must match. A stale bridge JWT
    // cannot authorize B using account A's wider access.
    global.__storyRpc = rpc;
    global.__rpcActor = "1";
    await flush(() => f.open(reloaded));
    assertHidden(/no longer available/);
    delete global.__rpcActor;
    await flush(() => f.open(reloaded));
    assert.ok(attribution());

    // Replies use the selected row, not the group's first row. A known source
    // revocation during the pre-send check also removes the already-open frame.
    await flush(() => global.__player.onStoryChange(1));
    let messageIntent;
    global.__sendStoryMessage = async (args) => {
      messageIntent = args;
      await args.beforeSend();
    };
    global.__storyRpc = async () => ({ data: null, error: null });
    await flush(() =>
      document.querySelector('button[aria-label="React ❤️"]').click(),
    );
    assert.equal(messageIntent.story.id, "102");
    assert.equal(messageIntent.expectedViewerId, "2");
    assert.equal(messageIntent.itemIndex, 1);
    assert.equal(
      messageIntent.story.items[1].url,
      "https://fixture.invalid/flyer.jpg",
    );
    assert.equal(messageIntent.isCurrent(), false);
    assertHidden(/no longer available/);
    delete global.__sendStoryMessage;

    // Invalid, mismatched and expired RPC data never falls back to cached media.
    for (const data of [
      { ...granted.data, shared_source: { ...source, id: "99" } },
      { ...granted.data, expires_at: new Date(Date.now() - 1).toISOString() },
      { ...granted.data, expires_at: "invalid" },
      { ...granted.data, shared_source: null },
    ]) {
      global.__storyRpc = async () => ({ data, error: null });
      await flush(() => f.open(reloaded));
      assertHidden(/no longer available/);
    }
    // A row that expires while the fresh read is pending must never display.
    deferReads();
    await flush(() => f.open(reloaded));
    await flush(() =>
      pendingReads[0]({
        ...granted,
        data: {
          ...granted.data,
          expires_at: new Date(Date.now() - 1).toISOString(),
        },
      }),
    );
    assertHidden(/no longer available/);
    global.__storyRpc = async () => ({
      ...granted,
      data: {
        ...granted.data,
        expires_at: new Date(Date.now() + 100).toISOString(),
      },
    });
    await flush(() => f.open(reloaded));
    assert.ok(attribution());
    await flush(() => new Promise((resolve) => setTimeout(resolve, 130)));
    assertHidden(/no longer available/);

    // An ordinary media story has no new network gate or changed media payload.
    const countBeforeOrdinary = rpcCalls.length;
    global.__storyRpc = () => {
      throw new Error("ordinary story must not authorize a shared source");
    };
    await flush(() =>
      f.open([
        {
          id: "900",
          userId: "1",
          username: "publisher",
          items: [
            {
              id: "900",
              type: "image",
              url: "https://fixture.invalid/ordinary.jpg",
            },
          ],
        },
      ]),
    );
    assert.ok(document.querySelector(".dvnt-story-viewer"));
    assert.equal(
      global.__player.stories[0].url,
      "https://fixture.invalid/ordinary.jpg",
    );
    assert.equal(rpcCalls.length, countBeforeOrdinary);
    assert.equal(viewers(), null, "ordinary other-member story has no Viewers button");
    await flush(() => f.useAuthStore.setState({ user: { id: "1", authId: "auth1" } }));
    assert.ok(viewers(), "ordinary owner keeps Viewers at the footer");
    assert.ok(viewers().closest("[data-story-footer]"));
    await flush(() => viewers().click());
    assert.equal(global.__viewersSheet.open, true);
    global.__viewersSheetRenders = [];
    await flush(() => f.useAuthStore.setState({ user: null }));
    assert.equal(viewers(), null);
    assert.equal(global.__viewersSheet.open, false);
    assert.ok(global.__viewersSheetRenders.every((render) => !render.open), "logout cannot transiently expose the viewers sheet before effects reset state");
    await flush(() => f.close());
    global.__storyRpc = rpc;

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
      "PASS story attribution DOM: real event action eligibility, source-only payload, single-flight, canonical cache, failed/retried UUID, reload/text media, minimal footer actions, exact CTA labels, owner/guest viewer eligibility, seven reactions, preserved per-segment author metadata/source links, fresh actor-bound playback, no cached media flash, revocation/expiry, account epochs and unmount isolation",
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
