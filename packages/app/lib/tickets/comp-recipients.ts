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
 *
 * A phone number gets a claim link instead, and DVNT never sends it: the
 * host's own phone texts it. Until the host has done that, a phone comp is
 * issued and not delivered.
 */

import type { CompClaimLink, CompResult } from "@dvnt/app/lib/api/privileged";

/** One request is capped server-side; the UI stops the host before the trip. */
export const MAX_COMP_RECIPIENTS = 100;

/** Desired total per recipient/tier, not an additive count on every retry. */
export const COMP_QUANTITIES = [1, 2, 3] as const;
export type CompQuantity = (typeof COMP_QUANTITIES)[number];
export function isCompQuantity(value: unknown): value is CompQuantity {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 3;
}

/** Distinguish several single-use links sent to the same phone. */
export function compClaimLinkLabel(links: CompClaimLink[], link: CompClaimLink): string {
  const recipientLinks = links.filter((item) => item.phone === link.phone);
  if (recipientLinks.length < 2) return link.recipient;
  const index = recipientLinks.findIndex((item) => item.ticket_id === link.ticket_id);
  return `${link.recipient} · Ticket ${index + 1} of ${recipientLinks.length}`;
}

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
/** Same shape test the server runs before trying to normalize a phone. */
const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/;

export interface CompRecipientPreview {
  /** Trimmed entries, in typed order, as they will be posted. */
  entries: string[];
  /** Entries that look like an email address. */
  emails: number;
  /** Entries that look like a phone number. The server decides if they are valid. */
  phones: number;
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
  let phones = 0;
  for (const entry of entries) {
    if (EMAIL.test(entry)) emails += 1;
    else if (!entry.startsWith("@") && PHONE_LIKE.test(entry)) phones += 1;
  }
  return {
    entries,
    emails,
    phones,
    members: entries.length - emails - phones,
    overLimit: entries.length > MAX_COMP_RECIPIENTS,
  };
}

/** The send control is live only when the server could succeed. */
export function canSubmitComp(input: {
  tierId: string | null | undefined;
  preview: CompRecipientPreview;
  sending: boolean;
  quantity?: number;
}): boolean {
  return (
    !input.sending &&
    isCompQuantity(input.quantity ?? 1) &&
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
  /** Phone comps newly minted. Resends rotate an existing ticket and are not counted. */
  phoneIssued: number;
  /** Claim links the host still has to text, one per ticket. */
  claimLinks: number;
  /** Every ticket that now exists. */
  totalIssued: number;
  /** Grouped member/guest email messages accepted by the provider, not inbox delivery. */
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
  const phoneIssued = result.phone_guest_issued ?? 0;
  const delivery = result.delivery ?? [];
  const delivered = delivery.filter((d) => d.status === "delivered").length;
  return {
    issued: result.issued,
    guestIssued,
    phoneIssued,
    claimLinks: result.claim_links?.length ?? 0,
    totalIssued: result.issued + guestIssued + phoneIssued,
    delivered,
    undelivered: delivery.filter((d) => d.status === "failed" || d.status === "not_available").length,
    skipped: result.skipped.length,
  };
}

/** Do not equate provider acceptance with inbox receipt or email count with passes. */
export function compEmailPresentation(result: CompResult) {
  const summary = summarizeCompResult(result);
  const queued = (result.delivery ?? []).filter((d) => d.status === "queued").length;
  return {
    label: "Ticket emails sent",
    detail: `${!(result.delivery?.length) && (summary.issued + summary.guestIssued > 0) ? "—" : summary.delivered} accepted for sending${queued ? ` · ${queued} queued` : ""}${summary.undelivered ? ` · ${summary.undelivered} need attention` : ""}`,
    explanation: "Email counts are messages, not ticket quantities. Inbox delivery is not guaranteed.",
    unknown: !(result.delivery?.length) && (summary.issued + summary.guestIssued > 0)
      ? "Email status is unavailable for this batch." : null,
    phoneNotice: summary.phoneIssued > 0 || summary.claimLinks > 0
      ? "Phone recipients receive a claim link to text. Ticket email follows account claim when a verified email address is available." : null,
    failureNotice: "The tickets stay valid. Do not comp again to retry email. Members can find their tickets in My Tickets; check the recipient's email address for follow-up.",
  };
}
