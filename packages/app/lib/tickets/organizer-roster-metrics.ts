import { hasAdmissionPurpose } from "./ticket-category.ts";
/** Management metrics describe issued credentials, not paid sales or venue capacity. */
export interface RosterMetricRow {
  status: string;
  category?: string | null;
  checked_in_at?: string | null;
}
export function isRosterCheckedIn(ticket: RosterMetricRow): boolean {
  return hasAdmissionPurpose(ticket.category) && (ticket.status === "scanned" || ticket.status === "checked_in" || !!ticket.checked_in_at);
}
export function organizerRosterMetrics(tickets: readonly RosterMetricRow[]) {
  return {
    issued: tickets.length,
    checkedIn: tickets.filter(isRosterCheckedIn).length,
    awaitingCheckIn: tickets.filter(ticket =>
      hasAdmissionPurpose(ticket.category) &&
      (ticket.status === "active" || ticket.status === "transfer_pending") &&
      !isRosterCheckedIn(ticket),
    ).length,
  };
}
