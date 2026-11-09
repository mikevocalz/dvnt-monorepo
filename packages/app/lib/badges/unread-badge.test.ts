import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUnreadCount, unreadBadgeText, unreadAccessibilityLabel } from "./unread-badge.ts";

test("no phantom zero, negative, invalid, or fractional badges", () => {
  for (const value of [undefined, null, NaN, Infinity, -2, 0, "9"]) {
    assert.equal(normalizeUnreadCount(value), 0);
    assert.equal(unreadBadgeText(value), undefined);
  }
  assert.equal(unreadBadgeText(1.9), "1");
});

test("one and two digits stay exact, overflow caps without losing accessible count", () => {
  assert.equal(unreadBadgeText(1), "1");
  assert.equal(unreadBadgeText(12), "12");
  assert.equal(unreadBadgeText(99), "99");
  assert.equal(unreadBadgeText(100), "99+");
  assert.equal(unreadBadgeText(10000), "99+");
  assert.equal(unreadAccessibilityLabel("Activity", 10000), "Activity, 10000 unread notifications");
  assert.equal(unreadAccessibilityLabel("Messages", 1), "Messages, 1 unread conversation");
  assert.equal(unreadAccessibilityLabel("Messages", 12), "Messages, 12 unread conversations");
  assert.equal(unreadAccessibilityLabel("Activity", 0), "Activity");
});
