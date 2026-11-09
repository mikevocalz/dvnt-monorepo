import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberEventRoute } from './member-event-route.ts';

test('public event review links canonicalize to their member event', () => {
  assert.equal(memberEventRoute('/public/events/42', '?section=reviews'), '/feed/events/42?section=reviews');
  assert.equal(memberEventRoute('/public/events/42/'), '/feed/events/42');
  assert.equal(memberEventRoute('/public/events/42', '?ref=HOST&promo=SAVE+TEN&ticket_type_id=tier&quantity=2&session_id=fixture&redirect_status=succeeded'), '/feed/events/42?ref=HOST&promo=SAVE+TEN&ticket_type_id=tier&quantity=2&session_id=fixture&redirect_status=succeeded');
});
test('queries cannot override the event, redirect destination or origin', () => {
  const path = memberEventRoute('/public/events/42', '?section=reviews&id=99&event_id=99&eventId=99&next=//evil.invalid&returnTo=/feed&redirect_uri=//evil.invalid&callbackURL=/auth');
  assert.equal(path, '/feed/events/42?section=reviews');
});
test('member routes, unrelated public pages and malformed IDs never redirect', () => {
  for (const path of ['/feed/events/42', '/public/events', '/public/events/42/embed', '/public/events/42/organizer', '/public/events/42/reviews', '/public/events/0', '/public/events/01', '/public/events/-1', '/public/events/1.5', '/public/events/9007199254740992', '/public/events/%34%32', '/public/events/42\n', '//evil.invalid/public/events/42']) {
    assert.equal(memberEventRoute(path), null, path);
  }
});
