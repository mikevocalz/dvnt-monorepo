import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStaffReturnTo, loginPathWithReturn, safeReturnTo, welcomePathWithReturn, readReturnToFromUrl } from './return-to.ts';

test('editor and console deep links use the shared DVNT login with an internal return path', () => {
  const target = '/admin/collections/posts?where[status]=draft';
  assert.equal(loginPathWithReturn(target), `/auth/login?returnTo=${encodeURIComponent(target)}`);
  assert.equal(safeReturnTo(target), target);
  for (const path of [
    '/admin',
    '/admin/collections/posts',
    '/admin/collections/posts?tab=drafts',
    '/console',
    '/console/overview',
  ]) {
    assert.equal(isStaffReturnTo(path), true, path);
  }
});

test('unsafe redirect targets never leave DVNT or bypass auth routes', () => {
  for (const path of [
    'https://example.invalid',
    '//example.invalid/admin',
    '%2F%2Fexample.invalid',
    '/\\example.invalid',
    '/auth/login',
    '/auth/social-callback',
    '/administer',
    '/administrator',
    '/feed',
  ]) {
    assert.equal(isStaffReturnTo(path), false, path);
  }
  assert.equal(safeReturnTo('https://example.invalid'), '/feed');
  assert.equal(loginPathWithReturn('//example.invalid'), '/auth/login');
});


test('optional welcome preserves the validated rating destination across reloads', () => {
  const destination = '/feed/events/42/reviews';
  const login = loginPathWithReturn(destination);
  const welcome = welcomePathWithReturn(new URL(login, 'https://fixture.invalid').searchParams.get('returnTo'));
  assert.equal(welcome, `/auth/welcome?returnTo=${encodeURIComponent(destination)}`);
  const previous = globalThis.window;
  try {
    globalThis.window = { location: { href: `https://fixture.invalid${welcome}` } } as any;
    assert.equal(readReturnToFromUrl(), destination);
    assert.equal(readReturnToFromUrl(), destination, 'repeat read does not consume intent');
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else globalThis.window = previous;
  }
  for (const unsafe of ['//evil.invalid', 'https://evil.invalid', '/auth/login', '/\\evil.invalid']) {
    assert.equal(welcomePathWithReturn(unsafe), '/auth/welcome');
  }
});

test('room return URLs keep path identity and cannot be replaced by redirect query data', () => {
  const target = '/feed/sneaky-lynk/room/room_123';
  for (const path of ['/sl/room_123', '/sneaky/room_123', '/sneaky-lynk/room/room_123', target]) {
    assert.equal(safeReturnTo(path + '?id=other&returnTo=%2Ffeed&next=%2Ffeed#other'), target);
  }
  for (const bad of ['/\t/evil.invalid', '/%09/evil.invalid', '/feed/../auth/login', '/feed/%2e%2e/auth/login', '/%61uth/login', '/auth?next=/feed', '/%252f%252fevil.invalid', '/feed\n']) {
    assert.equal(safeReturnTo(bad), '/feed', JSON.stringify(bad));
  }
  assert.equal(safeReturnTo('/admin/collections/posts?label=a%26b'), '/admin/collections/posts?label=a%26b');
  const previous = globalThis.window;
  try {
    globalThis.window = { location: { href: `https://fixture.invalid/auth/login?returnTo=${encodeURIComponent(target)}&returnTo=%2Ffeed` } } as any;
    assert.equal(readReturnToFromUrl(), '/feed', 'ambiguous duplicate return destinations are rejected');
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else globalThis.window = previous;
  }
});
