/**
 * node --test packages/app/features/game-night/components/use-chat-sheet-scroll.test.ts
 *
 * The chat BottomSheet unmounts its list while closed. Scroll-to-bottom ran
 * against a null ref, so reopening showed the oldest messages. Renders a
 * harness that mounts the list only while open, the way BottomSheet does.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const k of ["window", "document", "HTMLElement", "Node", "navigator"]) {
  Object.defineProperty(globalThis, k, {
    value: k === "window" ? win : (win as any)[k],
    configurable: true,
    writable: true,
  });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

// happy-dom does no layout: give the list a fixed content height and let
// scrollTop hold whatever is assigned.
const CONTENT = 2000, VIEWPORT = 300;
Object.defineProperty(win.HTMLElement.prototype, "scrollHeight", { get: () => CONTENT, configurable: true });
Object.defineProperty(win.HTMLElement.prototype, "clientHeight", { get: () => VIEWPORT, configurable: true });
const scrollTops = new WeakMap<object, number>();
Object.defineProperty(win.HTMLElement.prototype, "scrollTop", {
  get() { return scrollTops.get(this) ?? 0; },
  set(v: number) { scrollTops.set(this, v); },
  configurable: true,
});

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useChatSheetScroll } = await import("./use-chat-sheet-scroll.ts");

let api: ReturnType<typeof useChatSheetScroll>;
function Harness({ open }: { open: boolean }) {
  api = useChatSheetScroll(open);
  return open
    ? React.createElement("div", { ref: api.listRef, onScroll: api.onScroll, "data-list": "" })
    : null;
}

const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host as any);
const render = (open: boolean) => React.act(() => root.render(React.createElement(Harness, { open })));
const list = () => document.querySelector("[data-list]") as any;

test("reopening the sheet lands on the newest message and clears unread", async () => {
  render(false);
  React.act(() => {
    api.noteIncoming({ fromMe: false, listed: true });
    api.noteIncoming({ fromMe: false, listed: true });
    api.noteIncoming({ fromMe: true, listed: true });
    api.noteIncoming({ fromMe: false, listed: false });
  });
  assert.equal(api.unread, 2, "own messages and reactions are not unread");

  render(true);
  assert.equal(list().scrollTop, CONTENT, "list starts at the bottom");
  assert.equal(api.unread, 0);
  assert.equal(api.showNewPill, false);
});

test("scrolled up while open shows the pill; close and reopen resets it", async () => {
  render(true);
  list().scrollTop = 0;
  React.act(() => list().dispatchEvent(new win.Event("scroll")));
  React.act(() => api.noteIncoming({ fromMe: false, listed: true }));
  assert.equal(api.showNewPill, true);
  assert.equal(api.unread, 0, "messages seen in an open sheet are not unread");

  render(false);
  render(true);
  assert.equal(api.showNewPill, false);
  assert.equal(list().scrollTop, CONTENT);

  // atBottom was reset too: the next message scrolls instead of showing the pill.
  list().scrollTop = 1;
  React.act(() => api.noteIncoming({ fromMe: false, listed: true }));
  assert.equal(api.showNewPill, false);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(list().scrollTop, CONTENT);
});

after(async () => {
  React.act(() => root.unmount());
  await win.happyDOM.close();
});
