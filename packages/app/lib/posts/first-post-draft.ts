/**
 * Ticket → first post: which purchase earns a draft, and what that draft says.
 *
 * Pure on purpose. No React, no React Native, no Supabase — the rules that
 * decide whether a member's attendance becomes public are the part worth
 * testing directly, so they live where `node --test` can reach them.
 *
 * Fail closed everywhere. `normalizeVisibility` in lib/api/events.ts folds an
 * unknown value to "public" because a display surface has to render something;
 * this module does the opposite, because the cost of guessing wrong here is
 * outing someone.
 */

export interface ConfirmedEvent {
  id: number;
  title: string | null | undefined;
  /** Raw `events.visibility`. Legacy rows say "unlisted" for link_only. */
  visibility: string | null | undefined;
  /** City name from the event's own city row. Never inferred from the device. */
  cityName?: string | null;
}

/** A purchased line as `get-cart-status` returns it. */
export interface PurchasedLine {
  event_id?: number | null;
  category?: string | null;
}

export interface FirstPostDraft {
  eventId: number;
  /** The editable body of the text card, hashtags included. */
  content: string;
}

/**
 * Only the literal "public" is eligible. `undefined`, `null`, "unlisted", a
 * typo, a value this build has never heard of — all ineligible.
 */
export function isPublicEventVisibility(value: unknown): boolean {
  return value === "public";
}

/**
 * Coat check, merch and services are not admission. `category` is optional on
 * `MixedTicketDTO` and rows written before it existed were all admission, so a
 * missing category still counts; a stated non-admission category never does.
 */
export function isAdmissionLine(line: PurchasedLine): boolean {
  return line.category == null || line.category === "admission";
}

export function findAdmissionEventId(
  lines: readonly PurchasedLine[] | null | undefined,
): number | null {
  const line = (lines ?? []).find(
    (item) => isAdmissionLine(item) && typeof item.event_id === "number",
  );
  return line ? (line.event_id as number) : null;
}

/** `"Deviant DC"` → `"#DeviantDC"`. Nothing left after stripping means no tag. */
function hashtag(value: string | null | undefined): string | null {
  const body = (value ?? "").replace(/[^\p{L}\p{N}]/gu, "");
  return body ? `#${body}` : null;
}

export interface FirstPostDraftInput {
  event: ConfirmedEvent | null | undefined;
  lines: readonly PurchasedLine[] | null | undefined;
  /** This member has bought admission before, so this is not their first. */
  hasPriorAdmissionPurchase?: boolean;
}

/**
 * The draft, or `null` when this purchase earns none.
 *
 * Nothing identifying the order can reach the text: the inputs carry no ticket
 * id, order id, QR token, invite token or venue address, which is the cheapest
 * way to guarantee none of them gets printed.
 */
export function buildFirstPostDraft(
  input: FirstPostDraftInput,
): FirstPostDraft | null {
  if (input.hasPriorAdmissionPurchase) return null;

  const eventId = findAdmissionEventId(input.lines);
  if (eventId == null) return null;

  const event = input.event;
  if (!event || event.id !== eventId) return null;
  if (!isPublicEventVisibility(event.visibility)) return null;

  const title = (event.title ?? "").trim();
  if (!title) return null;

  const tags = [
    hashtag(title),
    hashtag(event.cityName),
    "#DVNT",
    "#DeviantEvents",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    eventId,
    content: `Hey, I just punched my ticket for "${title}" 🎟️\n\n${tags}`,
  };
}
