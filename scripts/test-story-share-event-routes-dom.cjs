#!/usr/bin/env node
// Real shared query, anonymous fetch, story footer and DM links. No live traffic.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildFixture, resolve } = require("./story-share-attribution-fixture.cjs");
(async () => {
  const { Window } = await import(resolve("happy-dom"));
  const window = new Window({ url: "https://fixture.invalid" });
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-event-routes-"));
  let app, f;
  try {
    await buildFixture({ outfile: path.join(dir, "fixture.cjs") });
    ({ f } = require(path.join(dir, "fixture.cjs")));
    const flush = (run) => f.act(async () => { await run?.(); await new Promise((r) => setTimeout(r, 10)); });
    const node = document.createElement("div");
    document.body.append(node);
    app = f.mountLinks(node);
    const source = { type: "event", id: "22", title: "Old snapshot title", author: { id: "9", username: "original", name: "Original", avatar: "" } };
    const share = { storyId: "42", sourceType: "event", sourceId: "22", sourceTitle: "Another old snapshot" };
    const paths = () => [...node.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    const response = (rows) => new Response(JSON.stringify(rows), { headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` } });
    let release;
    global.__eventIndexFetch = () => new Promise((r) => { release = r; });
    await flush(() => app.render(source, share));
    assert.deepEqual(paths(), ["/feed/events/22", "/feed/events/22"], "loading never uses a persisted title or the public purchase route");
    assert.equal(global.__eventIndexCalls.length, 1, "story and DM share one index request");
    await flush(() => release(response([{ id: 22, title: "Renamed Event", visibility: "public", status: "active" }])));
    assert.deepEqual(paths(), ["/events/renamed-event", "/events/renamed-event"]);
    await flush(() => node.querySelector("a").click());
    assert.equal(global.__routes.at(-1), "/events/renamed-event");
    let modifiedPrevented;
    const modified = new window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    await flush(() => { node.querySelector("a").dispatchEvent(modified); modifiedPrevented = modified.defaultPrevented; });
    assert.equal(modifiedPrevented, false, "modifier-click retains native link navigation");

    // Refetch retains old data with isSuccess=true. It is not a routing grant.
    await flush(() => { void f.client.invalidateQueries({ queryKey: ["events", "public-slug-index"] }); });
    assert.deepEqual(paths(), ["/feed/events/22", "/feed/events/22"], "stale retained data cannot route while its refresh is pending");
    await flush(() => release(response([{ id: 22, title: "New Current Title", visibility: "public", status: "active" }])));
    assert.deepEqual(paths(), ["/events/new-current-title", "/events/new-current-title"]);

    // A delayed response for the old selection cannot attach its path to a new ID.
    await flush(() => { void f.client.resetQueries({ queryKey: ["events", "public-slug-index"] }); });
    await flush(() => app.render({ ...source, id: "23" }, { ...share, sourceId: "23" }));
    assert.deepEqual(paths(), ["/feed/events/23", "/feed/events/23"]);
    await flush(() => release(response([{ id: 22, title: "Previous Event", visibility: "public", status: "active" }])));
    assert.deepEqual(paths(), ["/feed/events/23", "/feed/events/23"]);

    for (const rows of [
      [{ id: 22, title: "" }],
      [{ id: 22, title: "Same title", status: "active" }, { id: 23, title: "Same-title", status: "active" }],
      [{ id: 22, title: "Private title", visibility: "private" }],
      [],
    ]) {
      global.__eventIndexFetch = async () => response(rows);
      await flush(() => { void f.client.resetQueries({ queryKey: ["events", "public-slug-index"] }); });
      await flush(() => app.render(source, share));
      assert.deepEqual(paths(), ["/feed/events/22", "/feed/events/22"]);
    }
    global.__eventIndexFetch = async () => { throw new Error("offline"); };
    await flush(() => { void f.client.resetQueries({ queryKey: ["events", "public-slug-index"] }); });
    assert.deepEqual(paths(), ["/feed/events/22", "/feed/events/22"]);
    await flush(() => app.render({ ...source, type: "post", id: "11" }, { ...share, sourceType: "post", sourceId: "11" }));
    assert.deepEqual(paths(), ["/feed/post/11", "/feed/post/11"]);
    await flush(() => app.render(undefined, { ...share, sourceId: "javascript:alert(1)" }));
    assert.deepEqual(paths(), []);

    await flush(() => app.unmount());
    f.client.clear();
    const key = ["events", "public-slug-index"];
    const oldIndex = [{ id: 22, title: "Old Cached Title", status: "active", visibility: "public" }];
    f.client.setQueryData(key, oldIndex, { updatedAt: Date.now() - 60_000 });
    global.__eventIndexFetch = () => new Promise((r) => { release = r; });
    app = f.mountLinks(node);
    await flush(() => app.render(source, share));
    assert.deepEqual(paths(), ["/feed/events/22", "/feed/events/22"], "expired cache before mount is never a destination");
    await flush(() => release(response([{ ...oldIndex[0], title: "Fresh Title" }])));
    assert.deepEqual(paths(), ["/events/fresh-title", "/events/fresh-title"]);
    await flush(() => f.client.setQueryData(key, oldIndex, { updatedAt: Date.now() - 60_000 }));
    const readsBeforeSwitch = global.__eventIndexCalls.length;
    await flush(() => app.render({ ...source, id: "23" }, { ...share, sourceId: "23" }));
    assert.deepEqual(paths(), ["/feed/events/23", "/feed/events/23"]);
    assert.equal(global.__eventIndexCalls.length, readsBeforeSwitch + 1, "a new source requests exactly one shared stale-index refresh");
    await flush(() => release(response([{ ...oldIndex[0], id: 23, title: "Next Title" }])));
    assert.deepEqual(paths(), ["/events/next-title", "/events/next-title"]);

    // Detail identity is established once per URL, not dropped on idle expiry
    // or silently switched when a same-title event appears during a refresh.
    await flush(() => app.unmount());
    f.client.clear();
    global.__eventIndexFetch = async () => response([{ ...oldIndex[0], title: "Current Night" }]);
    app = f.mountTitleRoute(node);
    await flush(() => app.render("current-night"));
    await flush();
    const detailId = () => node.querySelector("output").getAttribute("data-title-id");
    assert.equal(detailId(), "22");
    await flush(() => f.client.setQueryData(key, [{ ...oldIndex[0], title: "Current Night" }], { updatedAt: Date.now() - 60_000 }));
    assert.equal(detailId(), "22", "idle freshness expiry cannot remove the opened event");
    global.__eventIndexFetch = () => new Promise((r) => { release = r; });
    await flush(() => { void f.client.invalidateQueries({ queryKey: key }); });
    assert.equal(detailId(), "22", "background refresh cannot tear down the opened screen");
    await flush(() => release(response([{ ...oldIndex[0], id: 23, title: "Current Night" }])));
    assert.equal(detailId(), "22", "new same-title event cannot replace the opened identity");
    await flush(() => f.client.setQueryData(key, oldIndex, { updatedAt: Date.now() - 60_000 }));
    const readsBeforeNavigation = global.__eventIndexCalls.length;
    await flush(() => app.render("another-night"));
    assert.equal(detailId(), "", "a new URL must not inherit the previous event identity");
    assert.equal(global.__eventIndexCalls.length, readsBeforeNavigation + 1);
    await flush(() => release(response([{ ...oldIndex[0], id: 23, title: "Another Night" }])));
    assert.equal(detailId(), "23");
    global.__eventIndexFetch = async () => { throw new Error("offline"); };
    await flush(() => { void f.client.invalidateQueries({ queryKey: key }); });
    assert.equal(detailId(), "23", "a failed index refresh does not destroy a validated detail identity");

    // A stale success can be paused offline without isFetching. It still cannot
    // establish a new title identity or link, even when cached data matches.
    await flush(() => app.unmount());
    f.client.clear();
    f.onlineManager.setOnline(false);
    f.client.setQueryData(key, oldIndex, { updatedAt: Date.now() - 60_000 });
    app = f.mountTitleRoute(node);
    const readsBeforeOffline = global.__eventIndexCalls.length;
    await flush(() => app.render("old-cached-title"));
    assert.equal(detailId(), "");
    assert.equal(global.__eventIndexCalls.length, readsBeforeOffline);
    await flush(() => app.unmount());
    app = f.mountLinks(node);
    await flush(() => app.render(source, share));
    assert.deepEqual(paths(), ["/feed/events/22", "/feed/events/22"]);
    global.__eventIndexFetch = async () => response([{ ...oldIndex[0], title: "Online Title" }]);
    await flush(() => f.onlineManager.setOnline(true));
    await flush();
    assert.deepEqual(paths(), ["/events/online-title", "/events/online-title"]);
    console.log("PASS story event routes: current canonical slug, deduplicated anonymous lookup, stale selections, fallback/error/duplicate links, modifier-click and unchanged posts");
  } finally {
    if (app && f) await f.act(async () => app.unmount());
    f?.onlineManager.setOnline(true);
    f?.client.clear();
    await window.happyDOM.abort();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
