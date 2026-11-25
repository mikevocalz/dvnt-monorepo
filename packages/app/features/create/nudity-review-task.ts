import type { NudityReview } from "./nudity-review-policy";

export const MEDIA_REVIEW_DEADLINE_MS = 8_000;

/** Bound the entire advisory check, including lazy chunks and media leases.
 * A timeout is an incomplete review, never a clean result or automatic publish.
 * The caller's cancellation signal remains distinct so Cancel returns to draft.
 */
export function runNudityReviewTask(
  task: (signal: AbortSignal) => Promise<NudityReview>,
  signal: AbortSignal,
  timeoutMs = MEDIA_REVIEW_DEADLINE_MS,
): Promise<NudityReview> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: NudityReview) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      resolve(result);
      controller.abort();
    };
    const cancel = () => finish({ flagged: false, incomplete: true });
    if (signal.aborted) { cancel(); return; }
    signal.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(cancel, timeoutMs);
    Promise.resolve().then(() => {
      if (controller.signal.aborted) return { flagged: false, incomplete: true };
      return task(controller.signal);
    }).then(finish, cancel);
  });
}
