/**
 * Outbox state machine, provider idempotency key and campaign copy for the
 * brand growth messages defined in
 * docs/dvnt-community-reliability-2026-09-16.md.
 *
 * The database owns the constraints (unique key, state CHECK, claim/complete
 * functions in 20260916180000_brand_message_outbox.sql). This module owns the
 * decision the worker makes between claiming a row and completing it, so the
 * transitions are testable without a database.
 *
 * Growth only. Tickets, receipts and order mail never enter this outbox.
 */

export type OutboxState =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "suppressed";

export type OutboxEvent =
  | "claim"
  | "delivered"
  | "transient_error"
  | "permanent_error"
  | "suppress";

export type OutboxChannel = "dm" | "email";

/** Attempts per row before a transient failure is recorded as final. */
export const MAX_ATTEMPTS = 5;

/**
 * Stable for the life of a row, and identical to the unique key
 * (campaign_version, recipient_id, channel). One string is both the row's
 * identity and what a provider is handed for deduplication, so a retry after a
 * lost acknowledgement cannot become a second message.
 */
export function providerIdempotencyKey(
  campaignVersion: string,
  recipientId: number,
  channel: OutboxChannel,
): string {
  return `${campaignVersion}:${recipientId}:${channel}`;
}

export interface TransitionResult {
  state: OutboxState;
  /** True when a retry is expected — the row goes back to queued. */
  retryable: boolean;
}

/**
 * The next state, or null when the event does not apply. sent, failed and
 * suppressed are terminal: a worker that wakes up holding a stale row cannot
 * reopen a finished campaign row or overwrite its receipt.
 */
export function transition(
  current: OutboxState,
  event: OutboxEvent,
  attemptCount = 0,
): TransitionResult | null {
  if (current === "sent" || current === "failed" || current === "suppressed") {
    return null;
  }
  if (event === "suppress") {
    return { state: "suppressed", retryable: false };
  }
  if (current === "queued") {
    return event === "claim" ? { state: "sending", retryable: false } : null;
  }
  // current === "sending"
  switch (event) {
    case "delivered":
      return { state: "sent", retryable: false };
    case "permanent_error":
      return { state: "failed", retryable: false };
    case "transient_error":
      return attemptCount >= MAX_ATTEMPTS
        ? { state: "failed", retryable: false }
        : { state: "queued", retryable: true };
    default:
      return null;
  }
}

// ── Campaign copy ──────────────────────────────────────────────────────
// Verbatim from the audit doc's "Welcome and first-post copy". Automated
// brand messages say so in the first line; nothing here is written as a
// person or as an event host.

export const BRAND_ANNOUNCEMENT_LABEL = "Deviant announcement — automated";

export const WELCOME_DM = [
  "Welcome to the cookout! The Black Queer cookout. DVNT is an 18+ community for Black, Brown and Queer people to connect through culture, expression and events — online and in person.",
  "",
  "Start with a photo and a little about yourself, then make your first post when you're ready. Bought a ticket? You can turn that moment into your first DVNT post.",
  "",
  "Be kind. Be considerate. No hate, harassment, transphobia, homophobia, biphobia, racism, anti-Blackness, xenophobia or sexism. No body-shaming or slut-shaming. Leave your hangups at home. Read our Community Standards, and report anything that makes this space unsafe.",
].join("\n");

export const WELCOME_BROADCAST =
  "Welcome to the cookout 🖤 Your first DVNT post can be a hello, a look, or your next event. Add a photo, tell us a little about yourself, and let your people find you. Ready? Create your first post.";

export interface CampaignMessage {
  subject: string;
  body: string;
}

/**
 * The copy for a campaign version, labelled as an automated announcement.
 * An unknown version returns null so the worker fails the row rather than
 * sending an empty message.
 */
export function campaignMessage(
  campaignVersion: string,
  unsubscribeUrl?: string | null,
): CampaignMessage | null {
  const copy =
    campaignVersion === "welcome_dm_v1"
      ? WELCOME_DM
      : campaignVersion === "first_post_v1"
        ? WELCOME_BROADCAST
        : null;
  if (!copy) return null;
  const footer = unsubscribeUrl
    ? `\n\nStop these messages: ${unsubscribeUrl}`
    : "";
  return {
    subject: "Welcome to the cookout — DVNT",
    body: `${BRAND_ANNOUNCEMENT_LABEL}\n\n${copy}${footer}`,
  };
}
