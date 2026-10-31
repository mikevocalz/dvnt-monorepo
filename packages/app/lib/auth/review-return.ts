/** Tab-local, account-bound intent across mandatory photo/first-post setup.
 * Stores navigation only: it never grants admission or skips a server check. */
const KEY = 'dvnt:review-return';
const MAX_AGE_MS = 60 * 60 * 1000;

export function reviewReturnPath(raw: string): string | null {
  const match = /^\/feed\/events\/([1-9]\d*)\/reviews\/?$/.exec(raw);
  return match && match[0] === raw && Number.isSafeInteger(Number(match[1]))
    ? `/feed/events/${match[1]}/reviews` : null;
}

export function rememberReviewReturn(userId: string | number | undefined, raw: string): void {
  const target = reviewReturnPath(raw);
  if (!userId || !target || typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ userId: String(userId), target, savedAt: Date.now() }));
  } catch { /* Storage can be disabled; do not block required setup. */ }
}

/** Consume only after the caller has confirmed required setup is complete. */
export function consumeReviewReturn(userId: string | number | undefined): string | null {
  if (!userId || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    window.sessionStorage.removeItem(KEY);
    const age = Date.now() - saved.savedAt;
    if (saved.userId !== String(userId) || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
    return typeof saved.target === 'string' ? reviewReturnPath(saved.target) : null;
  } catch {
    try { window.sessionStorage.removeItem(KEY); } catch { /* unavailable */ }
    return null;
  }
}

/** Explicitly leaving setup cancels this tab's pending review navigation. */
export function clearReviewReturn(): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(KEY); } catch { /* unavailable */ }
}

/** A deliberate move away from required setup abandons the stored return. */
export function clearReviewReturnOutsideSetup(pathname: string): void {
  if (!["/feed/onboarding/photo", "/feed/create", "/feed/camera", "/feed/crop-preview"].includes(pathname.replace(/\/$/, ""))) {
    clearReviewReturn();
  }
}
