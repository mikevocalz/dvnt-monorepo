import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishQueue } from './publish-queue.ts';
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
test('a second draft queues without sharing or clearing the first job state', async () => {
  const queue = createPublishQueue();
  const first = deferred();
  const second = deferred();
  const started: string[] = [];
  const a = queue.enqueue('one', 'first', async (report) => { started.push('a'); report('Uploading video'); await first.promise; });
  const b = queue.enqueue('one', 'second', async () => { started.push('b'); await second.promise; });
  assert.deepEqual(started, ['a']);
  assert.deepEqual(queue.getSnapshot().map((job) => job.status), ['running', 'queued']);
  queue.retry(a); queue.dismiss(a);
  assert.equal(queue.getSnapshot().length, 2, 'running work cannot be dismissed or duplicated');
  first.resolve(); await tick();
  assert.deepEqual(started, ['a', 'b']);
  assert.equal(queue.getSnapshot()[0].id, b);
  second.resolve(); await tick();
  assert.deepEqual(queue.getSnapshot(), []);
});
test('failure does not wedge later posts; retry retains original task and owner', async () => {
  const queue = createPublishQueue();
  let attempts = 0;
  const id = queue.enqueue('owner-a', 'first', async () => { if (++attempts === 1) throw new Error('Offline'); });
  let secondPublished = false;
  queue.enqueue('owner-b', 'second', async () => { secondPublished = true; });
  await tick();
  assert.equal(secondPublished, true);
  assert.deepEqual(queue.getSnapshot().map((job) => [job.id, job.ownerId, job.status, job.message]), [[id, 'owner-a', 'failed', 'Offline']]);
  queue.retry(id); queue.retry(id); await tick();
  assert.equal(attempts, 2);
  assert.equal(queue.getSnapshot().length, 0);
});
test('failed posts can be dismissed and pending work has a bounded memory footprint', async () => {
  const queue = createPublishQueue();
  const gate = deferred();
  queue.enqueue('owner', 'first', async () => gate.promise);
  for (let i = 0; i < 4; i++) queue.enqueue('owner', `post ${i}`, async () => {});
  assert.throws(() => queue.enqueue('owner', 'overflow', async () => {}), /pending post/);
  gate.resolve(); await tick();
  const id = queue.enqueue('owner', 'failed', async () => { throw Error('Retry later'); });
  await tick(); queue.dismiss(id);
  assert.equal(queue.getSnapshot().length, 0);
  queue.retry(id); await tick();
  assert.equal(queue.getSnapshot().length, 0);
});
