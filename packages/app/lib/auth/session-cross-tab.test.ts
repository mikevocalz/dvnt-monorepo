import test from 'node:test';
import assert from 'node:assert/strict';
import { installSessionCrossTab, SESSION_BOUNDARY_KEY } from './session-cross-tab.ts';

function harness() {
  const target = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const writes: Array<[string, string]> = [];
  const listeners = new Set<() => void>();
  let invalidations = 0;
  let revalidations = 0;
  let unsubscriptions = 0;
  const publish = () => { for (const listener of listeners) listener(); };
  const window = Object.assign(target, {
    document,
    localStorage: { setItem: (key: string, value: string) => { writes.push([key, value]); } },
  });
  const cleanup = installSessionCrossTab({
    target: window as unknown as Window,
    subscribe(listener) { listeners.add(listener); return () => { unsubscriptions++; listeners.delete(listener); }; },
    invalidate() { invalidations++; publish(); },
    revalidate() { revalidations++; },
  });
  const storage = (key: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key }));
  return { target, document, writes, listeners, publish, storage, cleanup,
    counts: () => ({ invalidations, revalidations, unsubscriptions }),
  };
}

test('local boundaries publish unique opaque signals; received signals invalidate without echo', () => {
  const h = harness();
  h.publish(); h.publish();
  assert.equal(h.writes.length, 2);
  assert.ok(h.writes.every(([key]) => key === SESSION_BOUNDARY_KEY));
  assert.notEqual(h.writes[0][1], h.writes[1][1]);
  h.storage(SESSION_BOUNDARY_KEY);
  assert.equal(h.counts().invalidations, 1);
  assert.equal(h.writes.length, 2, 'receiving a boundary must not echo its publication');
  h.storage(null);
  assert.equal(h.counts().invalidations, 2, 'clear() is also an invalidation');
  assert.equal(h.writes.length, 2);
  h.storage('unrelated-setting');
  assert.equal(h.counts().invalidations, 2);
  h.publish();
  assert.equal(h.writes.length, 3, 'local publication resumes after receiving');
  h.cleanup();
});

test('focus and visible-document changes revalidate without forcing a session boundary', () => {
  const h = harness();
  h.target.dispatchEvent(new Event('focus'));
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(h.counts(), { invalidations: 0, revalidations: 2, unsubscriptions: 0 });
  h.document.visibilityState = 'hidden';
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(h.counts().revalidations, 2);
  assert.deepEqual(h.writes, []);
  h.cleanup();
});

test('cleanup removes all window/document listeners and unsubscribes lifecycle observer', () => {
  const h = harness();
  assert.equal(h.listeners.size, 1);
  h.cleanup();
  assert.equal(h.listeners.size, 0);
  h.publish();
  h.storage(SESSION_BOUNDARY_KEY);
  h.storage(null);
  h.target.dispatchEvent(new Event('focus'));
  h.document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(h.counts(), { invalidations: 0, revalidations: 0, unsubscriptions: 1 });
  assert.deepEqual(h.writes, []);
});
