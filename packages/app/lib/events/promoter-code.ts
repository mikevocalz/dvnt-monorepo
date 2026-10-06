/**
 * Custom promoter code input (T06).
 *
 * Codes keep the case the host typed ("Tre151Share" stays "Tre151Share").
 * Matching never depends on case: event_promoters has a unique index on
 * (event_id, upper(code)), checkout looks codes up with ilike, and the
 * attribution SQL compares UPPER(code) = UPPER(p_code). So "TRE151SHARE" and
 * "tre151share" still hit the same promoter, and a second code differing only
 * in case is refused as a duplicate.
 */

export const PROMOTER_CODE_MAX = 32;

/** Same character set the server's CODE_RE accepts, case preserved. */
export function normalizePromoterCodeInput(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, PROMOTER_CODE_MAX);
}

/**
 * The message to show under the code field, or null when the failure is not
 * about the code (those still go to a toast). 409 with a code message is the
 * per-event duplicate; 400 with a code message is a format refusal.
 */
export function promoterCodeFieldError(
  error: { message?: string | null; status?: number | null } | null | undefined,
): string | null {
  const message = error?.message?.trim();
  if (!message || !/\bcode\b/i.test(message)) return null;
  if (error?.status === 409 || error?.status === 400) return message;
  return null;
}

/**
 * The message to show under the invite email field (name-only promoters), or
 * null when the failure is about something else. manage-promoters refuses a
 * malformed address with a 400 that names the email.
 */
export function promoterInviteEmailFieldError(
  error: { message?: string | null; status?: number | null } | null | undefined,
): string | null {
  const message = error?.message?.trim();
  if (!message || error?.status !== 400 || !/\bemail\b/i.test(message)) return null;
  return message;
}

/** Success toast copy for an add, from the server's inviteEmail status. */
export function promoterAddedDescription(code: string, inviteEmail: string | null | undefined): string {
  switch (inviteEmail) {
    case "sent":
      return `Code ${code}. We emailed them their invite.`;
    case "no_account":
      return `Code ${code}. Copy their link to share it.`;
    case "not_configured":
    case "failed":
    case "no_email":
      return `Code ${code}. The invite email didn't go out, so share their link.`;
    default:
      return `Code ${code}.`;
  }
}
