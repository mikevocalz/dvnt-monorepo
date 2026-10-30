/** Management metrics describe issued credentials, not paid sales or venue capacity. */
export interface RosterMetricRow {
  status: string;
  checked_in_at?: string | null;
}
export function isRosterCheckedIn(ticket: RosterMetricRow): boolean {
  return ticket.status === "scanned" || !!ticket.checked_in_at;
}
export function organizerRosterMetrics(tickets: readonly RosterMetricRow[]) {
  return {
    issued: tickets.length,
    checkedIn: tickets.filter(isRosterCheckedIn).length,
    awaitingCheckIn: tickets.filter(ticket =>
      (ticket.status === "active" || ticket.status === "transfer_pending") &&
      !isRosterCheckedIn(ticket),
    ).length,
  };
}
