import { describe, expect, it } from "vitest";
import { resolveAttendanceBreakdown } from "./event-analytics";

describe("resolveAttendanceBreakdown", () => {
  it("uses the host breakdown when present", () => {
    expect(
      resolveAttendanceBreakdown({
        attendanceBreakdown: { rsvp: 2, paid: 7, total: 12 },
        ticketStats: {
          total: 10,
          active: 8,
          checkedIn: 1,
          refunded: 1,
          void: 0,
          transferPending: 0,
        },
      }),
    ).toEqual({ rsvp: 2, paid: 7, total: 12 });
  });

  it("falls back safely when an older Edge Function omits the field", () => {
    expect(
      resolveAttendanceBreakdown({
        ticketStats: {
          total: 12,
          active: 8,
          checkedIn: 2,
          refunded: 1,
          void: 0,
          transferPending: 1,
        },
      }),
    ).toEqual({ rsvp: 0, paid: 0, total: 11 });
  });
});
