/**
 * Mobile Chrome/WebKit may resize and pan only visualViewport when the keyboard
 * opens. Keep this composer in document flow without treating dvh as keyboard
 * clearance, stealing focus, or chasing ordinary page/gallery scroll events.
 */
export function watchCommentComposerViewport(composer: HTMLElement) {
  const viewport = window.visualViewport;
  let frame = 0;
  let disposed = false;
  let geometry = "";
  const properties = ["--comment-keyboard-clearance", "--comment-gif-gallery-height"];
  const previous = properties.map((name) => composer.style.getPropertyValue(name));

  const update = () => {
    frame = 0;
    if (disposed) return;
    // Native pinch zoom remains available. Never mistake it for a keyboard or
    // fight the user's zoom/pan by resizing the gallery and scrolling the page.
    if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
    const height = viewport?.height ?? window.innerHeight;
    if (height <= 0) return;
    const top = viewport?.offsetTop ?? 0;
    const picker = composer.querySelector<HTMLElement>("[data-comment-gif-picker]");
    const gallery = picker?.querySelector<HTMLElement>("[data-comment-gif-gallery]");
    if (picker && gallery) {
      const chrome = picker.offsetHeight - gallery.offsetHeight;
      composer.style.setProperty("--comment-gif-gallery-height", `${Math.max(0, Math.min(256, height * 0.4, height - chrome - 16))}px`);
    }
    // The page needs scrollable room at its end even when the layout viewport
    // stays full-height. Do not subtract offsetTop: browser panning must not
    // resize this spacer and feed back into another automatic pan.
    composer.style.setProperty("--comment-keyboard-clearance", `${Math.max(0, window.innerHeight - height)}px`);
    if (!composer.contains(document.activeElement)) return;
    const textarea = composer.querySelector<HTMLTextAreaElement>("textarea");
    const target = picker && document.activeElement !== textarea
      ? picker
      : textarea?.parentElement;
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    const visibleTop = top + 8;
    const visibleBottom = top + height - 8;
    // For an unusually short viewport, favor the search/Close row rather than
    // scrolling it offscreen to expose the bottom of an oversized picker.
    const delta = bounds.top < visibleTop || bounds.height > height - 16
      ? bounds.top - visibleTop
      : Math.max(0, bounds.bottom - visibleBottom);
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "instant" });
  };
  const schedule = () => {
    if (!disposed && !frame) frame = window.requestAnimationFrame(update);
  };
  const onViewportChange = () => {
    // A visualViewport scroll event can come from ordinary document scrolling.
    // Ignore pageTop/pageLeft and unchanged bounds, otherwise the page would
    // repeatedly snap back while the user is reading comments or paging GIFs.
    const next = `${viewport?.height ?? window.innerHeight}:${viewport?.offsetTop ?? 0}:${viewport?.width ?? window.innerWidth}:${viewport?.scale ?? 1}`;
    if (next === geometry) return;
    geometry = next;
    schedule();
  };
  // Loading results, adding/removing a preview, or opening/closing the picker
  // changes geometry without a viewport event. No React rerender is required.
  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  observer?.observe(composer);
  onViewportChange();
  viewport?.addEventListener("resize", onViewportChange);
  viewport?.addEventListener("scroll", onViewportChange);
  window.addEventListener("resize", onViewportChange);
  composer.addEventListener("focusin", schedule);

  return () => {
    disposed = true;
    window.cancelAnimationFrame(frame);
    observer?.disconnect();
    viewport?.removeEventListener("resize", onViewportChange);
    viewport?.removeEventListener("scroll", onViewportChange);
    window.removeEventListener("resize", onViewportChange);
    composer.removeEventListener("focusin", schedule);
    properties.forEach((name, index) => {
      if (previous[index]) composer.style.setProperty(name, previous[index]);
      else composer.style.removeProperty(name);
    });
  };
}
