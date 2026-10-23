import assert from "node:assert/strict";
import test from "node:test";
import { watchCommentComposerViewport } from "./comment-composer-viewport.web.ts";

function fixture() {
  const previous = ["window", "document", "ResizeObserver"].map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  const styles = new Map<string, string>();
  const listeners = new Map<string, Set<EventListener>>();
  const viewport = Object.assign(new EventTarget(), {
    height: 852, width: 393, offsetTop: 0, scale: 1, pageTop: 0,
  });
  let scrollY = 0;
  let pickerOpen = true;
  let focused = true;
  let focusedTextarea = false;
  let intrinsicGalleryHeight = 400;
  let resize: () => void = () => {};
  const frames = new Map<number, FrameRequestCallback>();
  const scrolls: number[] = [];
  let nextFrame = 1;
  const gallery = {
    get offsetHeight() { return Math.min(intrinsicGalleryHeight, parseFloat(styles.get("--comment-gif-gallery-height") || "256")); },
  };
  const picker = {
    get offsetHeight() { return 92 + gallery.offsetHeight; },
    querySelector: () => gallery,
    getBoundingClientRect: () => ({ top: 600 - scrollY, bottom: 600 - scrollY + picker.offsetHeight, height: picker.offsetHeight }),
  };
  const textarea = {
    parentElement: { getBoundingClientRect: () => ({ top: 500 - scrollY, bottom: 572 - scrollY, height: 72 }) },
  };
  const composer = {
    style: {
      getPropertyValue: (key: string) => styles.get(key) || "",
      setProperty: (key: string, value: string) => styles.set(key, value),
      removeProperty: (key: string) => styles.delete(key),
    },
    querySelector: (selector: string) => selector === "textarea" ? textarea : pickerOpen ? picker : null,
    contains: () => focused,
    addEventListener: (event: string, listener: EventListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    removeEventListener: (event: string, listener: EventListener) => listeners.get(event)?.delete(listener),
  };
  const windowMock = Object.assign(new EventTarget(), {
    visualViewport: viewport, innerHeight: 852, innerWidth: 393,
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    scrollBy: ({ top }: { top: number }) => { scrolls.push(top); scrollY += top; },
  });
  Object.defineProperties(globalThis, {
    window: { configurable: true, value: windowMock },
    document: { configurable: true, value: { get activeElement() { return focusedTextarea ? textarea : {}; } } },
    ResizeObserver: { configurable: true, value: class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() { resize = () => {}; } } },
  });
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); };
  const dispose = watchCommentComposerViewport(composer as unknown as HTMLElement);
  return {
    styles, viewport, scrolls, picker, textarea, frames, flush,
    focusTextarea: () => { focusedTextarea = true; },
    setFocused: (value: boolean) => { focused = value; },
    setPickerOpen: (value: boolean) => { pickerOpen = value; resize(); },
    setGalleryHeight: (value: number) => { intrinsicGalleryHeight = value; resize(); },
    scrollPage: (value: number) => { scrollY = value; },
    event: (type: string) => viewport.dispatchEvent(new Event(type)),
    dispose,
    restore: () => {
      dispose();
      ["window", "document", "ResizeObserver"].forEach((key, index) => {
        if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    },
  };
}

test("visualViewport-only keyboard resize fits picker without changing the layout viewport", () => {
  const f = fixture();
  try {
    f.flush();
    Object.assign(f.viewport, { height: 320, offsetTop: 80 });
    f.event("resize"); f.event("scroll");
    assert.equal(f.frames.size, 1, "viewport events coalesce into one animation frame");
    f.flush();
    assert.equal(window.innerHeight, 852);
    assert.equal(f.styles.get("--comment-gif-gallery-height"), "128px");
    assert.equal(f.styles.get("--comment-keyboard-clearance"), "532px");
    assert(f.picker.getBoundingClientRect().top >= 88);
    assert(f.picker.getBoundingClientRect().bottom <= 392);
    f.viewport.offsetTop = 240;
    f.event("scroll"); f.flush();
    assert(f.picker.getBoundingClientRect().top >= 248, "offset-only keyboard pan reveals search/Close");
    assert.equal(f.styles.get("--comment-keyboard-clearance"), "532px", "panning does not resize clearance");
  } finally { f.restore(); }
});

test("unchanged visual scroll events and pinch zoom do not fight page scrolling", () => {
  const f = fixture();
  try {
    f.flush();
    const before = f.scrolls.length;
    f.scrollPage(0); f.viewport.pageTop = 200; f.event("scroll"); f.flush();
    assert.equal(f.scrolls.length, before);
    Object.assign(f.viewport, { scale: 2, height: 200, offsetTop: 120 });
    f.event("resize"); f.event("scroll"); f.flush();
    assert.equal(f.scrolls.length, before);
    assert.equal(f.styles.get("--comment-keyboard-clearance"), "0px");
    f.viewport.scale = 1; f.event("resize"); f.flush();
    assert.equal(f.styles.get("--comment-keyboard-clearance"), "652px");
    assert(Number.parseFloat(f.styles.get("--comment-gif-gallery-height")!) <= 92, "short viewports reserve search, Close, attribution and gutters");
  } finally { f.restore(); }
});

test("plain textarea uses same viewport correction and keyboard clearance is removed on recovery/cleanup", () => {
  const f = fixture();
  try {
    f.setPickerOpen(false); f.focusTextarea();
    Object.assign(f.viewport, { height: 320, offsetTop: 20 }); f.event("resize"); f.flush();
    assert(f.textarea.parentElement.getBoundingClientRect().bottom <= 332);
    assert.equal(f.styles.get("--comment-keyboard-clearance"), "532px");
    Object.assign(f.viewport, { height: 852, offsetTop: 0 }); f.event("resize"); f.flush();
    assert.equal(f.styles.get("--comment-keyboard-clearance"), "0px");
    f.event("resize"); f.dispose(); f.flush();
    assert.equal(f.styles.size, 0);
    f.viewport.height = 300; f.event("resize");
    assert.equal(f.frames.size, 0, "unmounted composer has no viewport listener");
  } finally { f.restore(); }
});

test("result expansion stays visible without scrolling an unfocused composer", () => {
  const f = fixture();
  try {
    f.setGalleryHeight(40); f.flush();
    Object.assign(f.viewport, { height: 320, offsetTop: 0 }); f.event("resize"); f.flush();
    f.setGalleryHeight(400); f.flush();
    assert(f.picker.getBoundingClientRect().bottom <= 312);
    f.setFocused(false); f.scrollPage(0);
    const before = f.scrolls.length;
    f.viewport.height = 280; f.event("resize"); f.flush();
    assert.equal(f.scrolls.length, before);
  } finally { f.restore(); }
});
