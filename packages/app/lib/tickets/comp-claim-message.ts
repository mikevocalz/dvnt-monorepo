/**
 * The text a host sends for a phone comp, and the plumbing around sending it
 * one recipient at a time. Pure: no expo-sms, no React, so node:test can run
 * it and both platforms share one copy.
 *
 * One link per recipient, always. A link is single use, so a group text
 * would hand every member the same ticket and the first to tap would take
 * it from the rest.
 */

/** Long titles get cut so the link stays inside one SMS segment when it can. */
const MAX_TITLE = 60;

export function compClaimMessage(eventTitle: string | null | undefined, url: string): string {
  const raw = (eventTitle ?? "").replace(/\s+/g, " ").trim();
  const title = raw.length > MAX_TITLE ? `${raw.slice(0, MAX_TITLE - 1).trimEnd()}…` : raw;
  const what = title ? `a ticket to ${title}` : "a ticket";
  return `I got you ${what} on DVNT. Tap to claim it, the link works once: ${url}`;
}

/**
 * `sms:` URL for the web fallback. `?&body=` is the form both iOS Messages
 * and Android's default SMS app read; the recipient is a single E.164
 * number, never a list.
 */
export function smsHref(phone: string, body: string): string {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Phone must be E.164");
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

export type ClaimSendStatus = "pending" | "sent" | "opened" | "shared" | "cancelled" | "failed";

/**
 * expo-sms reports `sent` and `cancelled` on iOS. Android always says
 * `unknown`: the composer opened and DVNT cannot see what happened after, so
 * that is "opened", never "sent".
 */
export function statusFromSmsResult(result: string | null | undefined): ClaimSendStatus {
  if (result === "sent") return "sent";
  if (result === "cancelled") return "cancelled";
  return "opened";
}

/** Whether a "Text all" run should move on to the next person. */
export function continuesQueue(status: ClaimSendStatus): boolean {
  return status === "sent" || status === "opened" || status === "shared";
}

/** Links still to text, in the order the server returned them. */
export function unsentLinks<T extends { ticket_id: string }>(
  links: readonly T[],
  statuses: Readonly<Record<string, ClaimSendStatus | undefined>>,
): T[] {
  return links.filter((l) => {
    const s = statuses[l.ticket_id];
    return s === undefined || s === "pending" || s === "cancelled" || s === "failed";
  });
}

/** Reads the token out of a route param, rejecting anything that is not one. */
export function claimTokenFromParam(param: string | string[] | undefined): string | null {
  const value = Array.isArray(param) ? param[0] : param;
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
