/**
 * Modal focus management for web sheets and dialogs.
 *
 * While `open`: moves focus into the container (first focusable element, or
 * the container itself), keeps Tab and Shift+Tab cycling inside it, and on
 * close returns focus to whatever had it before the dialog opened (the
 * opener button, usually).
 */
import { useEffect, useLayoutEffect, type RefObject } from "react";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute("inert") && el.getAttribute("aria-hidden") !== "true",
  );
}

export function useDialogFocus(
  open: boolean,
  containerRef: RefObject<HTMLElement | null>,
) {
  useIsomorphicLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    if (!container.contains(document.activeElement)) {
      const first = focusables(container)[0];
      (first ?? container).focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = focusables(container);
      if (items.length === 0) {
        e.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !container.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !container.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);
}
