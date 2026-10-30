/** UI preflight only; the server repeats every check under a ticket lock. */
export interface CompCancelTicket {
  id: string;
  event_id: number;
  user_id: string;
  event_title?: string;
  event_location?: string;
  holder_name?: string | null;
  username?: string;
  ticket_type_name?: string;
  organizer_free_cancel?: { eligible: boolean; reason: string | null };
}
export function canSubmitCompCancellation(
  ticket: CompCancelTicket | null,
  eventId: number,
  reason: string,
) {
  return (
    !!ticket &&
    ticket.event_id === eventId &&
    !!ticket.user_id &&
    ticket.organizer_free_cancel?.eligible === true &&
    reason.trim().length >= 5 &&
    reason.trim().length <= 240
  );
}
export const COMP_CANCEL_WARNING =
  "This permanently cancels only this ticket. Its QR will no longer work when checked online. Offline scanners must reconnect and refresh. No refund, replacement ticket, or recipient message is sent. If accounting checks require manual review, nothing is changed.";
export function compCancelHolder(ticket: CompCancelTicket) {
  return ticket.username
    ? `@${ticket.username}`
    : `Account ${ticket.user_id}`;
}
