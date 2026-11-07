import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomReturnPath } from './room-return.ts';

test('every supported room alias returns only that canonical room', () => {
  for (const base of ['/sneaky-lynk/room/', '/feed/sneaky-lynk/room/', '/sl/', '/sneaky/', '/sneaky-lynk/', '/feed/sneaky-lynk/']) {
    for (const suffix of ['', '/', '?id=another&returnTo=%2Ffeed&next=https://evil.invalid', '#another']) {
      assert.equal(roomReturnPath(base + 'room_123' + suffix), '/feed/sneaky-lynk/room/room_123');
    }
  }
  assert.equal(roomReturnPath('/sl/room%5F123'), '/feed/sneaky-lynk/room/room_123');
});

test('malformed, reserved and non-room paths never become a different room', () => {
  for (const path of ['/feed', '/sl/', '/sl/..', '/sl/a/b', '/sl/a%2Fb', '/sl/a%252Fb', '/sl/a%3Fb', '/sl/a%0A', '/sl/a%20', '/sl/a%00', '/sl/a\\b', '/sl/%', '/sl/' + 'a'.repeat(129), '//evil.invalid/sl/a', '/sl/a\n', '/sneaky-lynk/create', '/feed/sneaky-lynk/billing', '/sneaky-lynk/room', '/sneaky/success', '/sneaky/cancel']) {
    assert.equal(roomReturnPath(path), null, JSON.stringify(path));
  }
});
