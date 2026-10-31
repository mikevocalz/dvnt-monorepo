import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rememberReviewReturn, consumeReviewReturn, reviewReturnPath, clearReviewReturnOutsideSetup } from './review-return.ts';

test('review intent survives setup reloads, is newest-wins, account-bound and single-use', () => {
  const previous = globalThis.window;
  const data = new Map<string, string>();
  try {
    globalThis.window = { sessionStorage: { getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) } } as any;
    rememberReviewReturn('member-a', '/feed/events/42/reviews');
    for (const path of ['/feed/onboarding/photo', '/feed/create', '/feed/camera', '/feed/crop-preview']) clearReviewReturnOutsideSetup(path);
    assert.equal(data.size, 1, 'intent is not consumed by setup navigation/reload');
    clearReviewReturnOutsideSetup('/feed/events/my-tickets');
    assert.equal(consumeReviewReturn('member-a'), null, 'leaving setup abandons the return');
    rememberReviewReturn('member-a', '/feed/events/42/reviews');
    rememberReviewReturn('member-a', '/feed/events/43/reviews/');
    assert.equal(consumeReviewReturn('member-a'), '/feed/events/43/reviews');
    assert.equal(consumeReviewReturn('member-a'), null);
    rememberReviewReturn('member-a', '/feed/events/42/reviews');
    assert.equal(consumeReviewReturn('member-b'), null, 'account switch never resumes another member intent');
    assert.equal(consumeReviewReturn('member-a'), null, 'mismatched intent is discarded');
    for (const invalid of [null, '{', JSON.stringify({ userId: 'member-a', target: '//evil.invalid', savedAt: Date.now() }),
      JSON.stringify({ userId: 'member-a', target: '/feed/events/42/reviews', savedAt: Date.now() - 3600001 }),
      JSON.stringify({ userId: 'member-a', target: '/feed/events/42/reviews', savedAt: Date.now() + 60000 })]) {
      if (invalid) data.set('dvnt:review-return', invalid);
      assert.equal(consumeReviewReturn('member-a'), null);
    }
    globalThis.window = { sessionStorage: { getItem() { throw Error('disabled'); }, setItem() { throw Error('disabled'); }, removeItem() { throw Error('disabled'); } } } as any;
    assert.doesNotThrow(() => rememberReviewReturn('member-a', '/feed/events/42/reviews'));
    assert.equal(consumeReviewReturn('member-a'), null);
  } finally {
    if (previous === undefined) delete (globalThis as any).window;
    else globalThis.window = previous;
  }
});

test('only canonical positive event review paths may survive required setup', () => {
  assert.equal(reviewReturnPath('/public/events/42/reviews'), '/feed/events/42/reviews');
  for (const value of ['/feed', '/auth/login', '//evil.invalid', '/feed/events/42/reviews?next=/feed',
    '/feed/events/0/reviews', '/feed/events/42/reviews\n', '/feed/events/42/reviews/../organizer']) {
    assert.equal(reviewReturnPath(value), null);
  }
});

test('existing detail review sections survive setup without accepting query instructions', () => {
  for (const prefix of ['feed', 'public']) {
    assert.equal(reviewReturnPath(`/${prefix}/events/82?section=reviews`), '/feed/events/82?section=reviews');
  }
  for (const raw of ['/feed/events/0?section=reviews', '/feed/events/01?section=reviews', '/feed/events/9007199254740992?section=reviews', '/feed/events/82?section=reviews&next=/feed', '/feed/events/82?section=reviews&section=reviews', '/feed/events/82?section=reviews\n']) {
    assert.equal(reviewReturnPath(raw), null);
  }
});
