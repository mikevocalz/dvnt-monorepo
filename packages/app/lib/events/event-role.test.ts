import test from "node:test";
import assert from "node:assert/strict";
import {
  canDeleteEvent,
  canEditEvent,
  canManageStaff,
  canScanTickets,
  canViewFullRoster,
  canViewPayouts,
  eventRoleLabel,
  isEventStaff,
  type EventRole,
} from "./event-role.ts";

const ALL: EventRole[] = ["owner", "admin", "editor", "scanner", null];

test("every staff role can scan — that is what the scanner role is for", () => {
  for (const role of ALL) {
    assert.equal(canScanTickets(role), role !== null, String(role));
  }
});

test("the regression: a scanner is admitted to the door", () => {
  // The owner-only client gate this replaces returned false here, so somebody
  // given the scanner role was refused the scanner screen.
  assert.equal(canScanTickets("scanner"), true);
  assert.equal(isEventStaff("scanner"), true);
});

test("a scanner cannot reach anything beyond the door", () => {
  assert.equal(canEditEvent("scanner"), false);
  assert.equal(canViewFullRoster("scanner"), false);
  assert.equal(canManageStaff("scanner"), false);
  assert.equal(canViewPayouts("scanner"), false);
  assert.equal(canDeleteEvent("scanner"), false);
});

test("money and destruction stay with the owner", () => {
  for (const role of ALL) {
    assert.equal(canViewPayouts(role), role === "owner", `payouts/${role}`);
    assert.equal(canDeleteEvent(role), role === "owner", `delete/${role}`);
  }
});

test("the ladder is monotonic — a higher role can do everything a lower one can", () => {
  const ladder: Exclude<EventRole, null>[] = ["scanner", "editor", "admin", "owner"];
  const caps = [canScanTickets, canEditEvent, canViewFullRoster, canManageStaff];
  for (const cap of caps) {
    let seenTrue = false;
    for (const role of ladder) {
      const allowed = cap(role);
      if (seenTrue) {
        assert.equal(allowed, true, `${cap.name} regressed at ${role}`);
      }
      if (allowed) seenTrue = true;
    }
  }
});

test("a non-member is refused everything", () => {
  for (const cap of [
    canScanTickets,
    canEditEvent,
    canViewFullRoster,
    canManageStaff,
    canViewPayouts,
    canDeleteEvent,
    isEventStaff,
  ]) {
    assert.equal(cap(null), false, cap.name);
  }
});

test("roles are named for what they actually are", () => {
  assert.equal(eventRoleLabel("scanner"), "Door staff");
  assert.equal(eventRoleLabel("owner"), "Host");
  assert.equal(eventRoleLabel(null), "");
});
