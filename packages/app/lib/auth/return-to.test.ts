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
