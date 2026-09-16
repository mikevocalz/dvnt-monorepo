/**
 * Comping is this product's guest list. There is no separate invite feature,
 * so "add someone to a private event" and "issue them a free ticket" are the
 * same action, and both platforms have to agree on three things before the
 * server is even asked: who may do it, what the typed list resolves to, and
 * what came back.
 *
 * Issued is not delivered. A guest ticket exists the moment the server mints
 * it; the claim email is a separate outcome that can fail on its own. Every
 * count here keeps those apart — collapsing them is how a host tells someone
 * "you're on the list" for a mail that bounced.
 */

import type { CompResult } from "@dvnt/app/lib/api/privileged";

/** One request is capped server-side; the UI stops the host before the trip. */
export const MAX_COMP_RECIPIENTS = 100;

/**
 * Owner or accepted admin co-organizer, matching the `bulk-comp-tickets`
 * check. Editors and scanners see no control at all rather than a control
 * that fails — the server is still the authority, this only keeps the UI
 * from promising something it cannot do.
 */
export function canCompTickets(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CompRecipientPreview {
  /** Trimmed entries, in typed order, as they will be posted. */
  entries: string[];
  /** Entries that look like an email address. */
  emails: number;
  /** Everything else, treated as a DVNT username. */
  members: number;
  /** Past the server's batch cap — nothing should be sent. */
  overLimit: boolean;
}

/** Splits a comma / semicolon / newline list into what will actually be sent. */
export function parseCompRecipients(raw: string): CompRecipientPreview {
  const entries = raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  let emails = 0;
  for (const entry of entries) if (EMAIL.test(entry)) emails += 1;
  return {
    entries,
    emails,
    members: entries.length - emails,
    overLimit: entries.length > MAX_COMP_RECIPIENTS,
  };
}

/** The send control is live only when the server could succeed. */
export function canSubmitComp(input: {
  tierId: string | null | undefined;
  preview: CompRecipientPreview;
  sending: boolean;
}): boolean {
  return (
    !input.sending &&
    !!input.tierId &&
    input.preview.entries.length > 0 &&
    !input.preview.overLimit
  );
}

export interface CompSummary {
  /** Tickets into existing accounts. */
  issued: number;
  /** Guest tickets minted for emails with no account. */
  guestIssued: number;
  /** Every ticket that now exists. */
  totalIssued: number;
  /** Claim emails the mailer confirmed. */
  delivered: number;
  /** Minted, not emailed. The tickets are valid; the host has to follow up. */
  undelivered: number;
  skipped: number;
}

/**
 * ponytail: counts only. Which address failed and why stays in
 * `result.delivery` for the UI to list — duplicating it here would be a
 * second copy to keep in sync.
 */
export function summarizeCompResult(result: CompResult): CompSummary {
  const guestIssued = result.guest_issued ?? 0;
  const delivery = result.delivery ?? [];
  const delivered = delivery.filter((d) => d.status === "delivered").length;
  return {
    issued: result.issued,
    guestIssued,
    totalIssued: result.issued + guestIssued,
    delivered,
    undelivered: delivery.length - delivered,
    skipped: result.skipped.length,
  };
}
