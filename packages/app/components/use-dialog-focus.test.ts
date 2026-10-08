/**
 * node --test packages/app/components/use-dialog-focus.test.ts
 *
 * BottomSheet (web) is a modal: focus has to move in on open, stay in while
 * tabbing, and go back to the opener on close.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const win = new Window({ url: "http://localhost/" });
for (const k of ["window", "document", "HTMLElement", "Node", "navigator", "KeyboardEvent"]) {
  Object.defineProperty(globalThis, k, {
    value: k === "window" ? win : (win as any)[k],
    configurable: true,
    writable: true,
  });
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { useDialogFocus } = await import("./use-dialog-focus.ts");

const h = React.createElement;
function Sheet({ open, buttons = 2 }: { open: boolean; buttons?: number }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, ref);
  if (!open) return null;
  return h("div", { ref, tabIndex: -1, "data-panel": "" },
    ...Array.from({ length: buttons }, (_, i) => h("button", { key: i, "data-i": String(i) }, `b${i}`)));
}

const opener = document.createElement("button");
opener.textContent = "Chat";
document.body.appendChild(opener);
const host = document.createElement("div");
document.body.appendChild(host);
const root = createRoot(host as any);
const render = (open: boolean, buttons?: number) =>
  React.act(() => root.render(h(Sheet, { open, buttons })));
const tab = (shiftKey = false) => {
  const e = new win.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(e as unknown as Event);
  return e.defaultPrevented;
};
const activeIndex = () => (document.activeElement as any)?.getAttribute("data-i");

test("open moves focus to the first control inside the sheet", () => {
  opener.focus();
  render(true);
  assert.equal(activeIndex(), "0");
});

test("Tab from the last control wraps to the first, Shift+Tab from the first wraps to the last", () => {
  (document.querySelector("[data-i='1']") as any).focus();
  assert.equal(tab(), true);
  assert.equal(activeIndex(), "0");
  assert.equal(tab(true), true);
  assert.equal(activeIndex(), "1");
});

test("close returns focus to the opener", () => {
  render(false);
  assert.ok(document.activeElement === opener, "focus is back on the opener");
});

test("a sheet with no controls focuses the panel itself", () => {
  opener.focus();
  render(true, 0);
  assert.ok((document.activeElement as any)?.hasAttribute("data-panel"));
  render(false);
});

after(async () => {
  React.act(() => root.unmount());
  await win.happyDOM.close();
});
