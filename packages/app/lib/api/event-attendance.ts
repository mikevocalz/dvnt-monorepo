/**
 * Attendance numbers for the event analytics screens. Kept apart from
 * event-analytics.ts, which imports the edge client, so node:test can load it.
 */
import type { EventAnalyticsSummary, EventAttendanceBreakdown } from "./event-analytics.ts";

export function resolveAttendanceBreakdown(
  summary: Pick<EventAnalyticsSummary, "attendanceBreakdown" | "ticketStats">,
): EventAttendanceBreakdown {
  const raw = summary.attendanceBreakdown;
  if (
    raw &&
    Number.isFinite(raw.rsvp) &&
    Number.isFinite(raw.paid) &&
    Number.isFinite(raw.total)
  ) {
    return {
      rsvp: Math.max(0, Math.trunc(raw.rsvp)),
      paid: Math.max(0, Math.trunc(raw.paid)),
      total: Math.max(0, Math.trunc(raw.total)),
    };
  }

  const { ticketStats } = summary;
  return {
    rsvp: 0,
    paid: 0,
    total: Math.max(
      0,
      Number(ticketStats.active || 0) +
        Number(ticketStats.checkedIn || 0) +
        Number(ticketStats.transferPending || 0),
    ),
  };
}
