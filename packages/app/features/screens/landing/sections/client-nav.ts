/**
 * clientNav — a press/click handler for header anchors that navigates
 * CLIENT-SIDE (Solito App-Router router.push) on a plain left click, so the
 * persistent root-layout header never reloads/remounts. Modifier and middle
 * clicks fall through to the browser so "open in new tab" still works; keep the
 * element's real href for SEO + middle-click.
 */
type PushRouter = { push: (href: string) => void };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clientNav(router: PushRouter, href: string, after?: () => void) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (e?: any) => {
    if (
      e &&
      (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1)
    ) {
      return; // let the browser open a new tab / window
    }
    e?.preventDefault?.();
    router.push(href);
    after?.();
  };
}
