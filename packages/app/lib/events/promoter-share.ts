/**
 * The text a promoter (or host) shares for a promoter code (T08): the code,
 * the event link carrying ?ref=<code> so the sale is attributed, and a short
 * event description.
 *
 * Pure so node:test can reach it. The caller passes the event URL from
 * shareUrls.event (lib/deep-linking/share-link.ts); /e/:id redirects to the
 * public event page, which reads ?ref= into the promoter-ref store.
 */

export const PROMOTER_SHARE_DESCRIPTION_MAX = 140;

/** Collapse whitespace and cut at a word boundary, ending with an ellipsis. */
export function truncateDescription(
  text: string | null | undefined,
  max = PROMOTER_SHARE_DESCRIPTION_MAX,
): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const head = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${head.replace(/[\s.,;:!?-]+$/, "")}…`;
}

/** Adds ?ref=<code> (or &ref=) to the event URL. */
export function promoterEventLink(eventUrl: string, code: string): string {
  const joiner = eventUrl.includes("?") ? "&" : "?";
  return `${eventUrl}${joiner}ref=${encodeURIComponent(code)}`;
}

export interface PromoterShareInput {
  code: string;
  eventUrl: string;
  eventTitle?: string | null;
  eventDescription?: string | null;
}

export interface PromoterShareContent {
  title: string;
  message: string;
  url: string;
}

export function buildPromoterShareMessage(input: PromoterShareInput): PromoterShareContent {
  const url = promoterEventLink(input.eventUrl, input.code);
  const title = (input.eventTitle ?? "").trim();
  const description = truncateDescription(input.eventDescription);
  const head = [title, description].filter(Boolean);
  const ask = `Use my code ${input.code} for tickets: ${url}`;
  return {
    title: title || "Tickets on DVNT",
    message: head.length ? `${head.join("\n")}\n\n${ask}` : ask,
    url,
  };
}

/** SMS composer link. `sms:?&body=` is the form both iOS and Android accept. */
export function promoterSmsHref(message: string): string {
  return `sms:?&body=${encodeURIComponent(message)}`;
}
