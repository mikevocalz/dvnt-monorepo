import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublishQueue } from './publish-queue.ts';
import { createPublishTask, type PublishTaskDeps } from './publish-task.ts';
import type { PublishDescriptor } from './publish-descriptor.ts';
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

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}
const read = (storage: ReturnType<typeof memoryStorage>) =>
  JSON.parse(storage.map.get('post-publish-queue') ?? '[]');
function draft(over: Partial<PublishDescriptor> = {}): PublishDescriptor {
  return {
    operationId: 'op-1', postKind: 'media', content: 'caption', slides: [],
    textTheme: 'graphite', location: '', isNSFW: false,
    files: [{ uri: 'ph://picked-asset', type: 'image', mimeType: 'image/jpeg' }],
    placedTags: [], uploaded: [null], ...over,
  };
}
/** Records what a rebuilt task actually sends, so a double publish is visible. */
function recorder(over: Partial<PublishTaskDeps> = {}) {
  const published: Array<{ operationId: string; authorId: string; media: number }> = [];
  const uploads: string[] = [];
  const deps: PublishTaskDeps = {
    currentOwnerId: () => 'owner-a',
    persistMedia: async (file) => ({ ...file, uri: `file:///app/${file.uri.replace(/\W+/g, '-')}.jpg` }),
    uploadMedia: async (files) => files.map((file) => {
      uploads.push(file.uri);
      return { type: 'image' as const, url: `https://cdn.test/${uploads.length}.jpg` };
    }),
    createPost: async (input) => {
      published.push({ operationId: input.operationId, authorId: input.expectedAuthorId, media: input.media.length });
      return { id: 77 };
    },
    addPlacedTags: () => {},
    ...over,
  };
  return { published, uploads, deps };
}
test('a killed publish is rebuilt from storage and replays the same operation', async () => {
  const storage = memoryStorage();
  const gate = deferred();
  const dying = createPublishQueue();
  dying.configure({ storage });
  dying.enqueue('owner-a', 'Sharing your post', async () => gate.promise, draft());
  const [saved] = read(storage);
  assert.equal(saved.ownerId, 'owner-a');
  assert.equal(saved.descriptor.operationId, 'op-1');
  assert.equal(saved.descriptor.files[0].uri, 'ph://picked-asset');

  // Relaunch over the same storage: the closure is gone, the descriptor is not.
  const released: string[] = [];
  const { published, uploads, deps } = recorder();
  const relaunched = createPublishQueue();
  relaunched.configure({
    storage,
    release: (descriptor) => released.push(descriptor.files[0].uri),
    build: (descriptor, ownerId) => createPublishTask(descriptor, ownerId, deps),
  });
  assert.equal(relaunched.restore(), 1);
  assert.equal(relaunched.getSnapshot()[0].resumed, true);
  assert.equal(relaunched.restore(), 0, 'a second restore cannot queue the same job twice');
  await tick();
  assert.deepEqual(uploads, ['file:///app/ph-picked-asset.jpg'], 'uploads the app-storage copy');
  assert.deepEqual(published, [{ operationId: 'op-1', authorId: 'owner-a', media: 1 }]);
  assert.deepEqual(relaunched.getSnapshot(), []);
  assert.deepEqual(read(storage), [], 'nothing is left to replay on the next launch');
  assert.deepEqual(released, ['file:///app/ph-picked-asset.jpg'], 'the copy is deleted');
});
const stored = (descriptor: PublishDescriptor) => JSON.stringify([
  { id: 'job-1', ownerId: 'owner-a', label: 'Sharing your post', descriptor },
]);
test('media gone on relaunch fails with the real reason and keeps the job', async () => {
  const storage = memoryStorage();
  const { published, deps } = recorder({
    persistMedia: async () => {
      throw new Error('Selected media is no longer available. Please remove it and add it again.');
    },
  });
  const queue = createPublishQueue();
  queue.configure({ storage, build: (d, ownerId) => createPublishTask(d, ownerId, deps) });
  storage.setItem('post-publish-queue', stored(draft()));
  assert.equal(queue.restore(), 1);
  await tick();
  assert.deepEqual(queue.getSnapshot().map((job) => [job.status, job.message]), [[
    'failed', 'Selected media is no longer available. Please remove it and add it again.',
  ]]);
  assert.deepEqual(published, []);
  assert.equal(read(storage).length, 1, 'a failed job is kept, not silently dropped');
});
test('a restored job never publishes under whoever is signed in now', async () => {
  const storage = memoryStorage();
  const { published, deps } = recorder({ currentOwnerId: () => 'owner-b' });
  const queue = createPublishQueue();
  queue.configure({ storage, build: (d, ownerId) => createPublishTask(d, ownerId, deps) });
  storage.setItem('post-publish-queue', stored(draft()));
  queue.restore();
  await tick();
  assert.deepEqual(published, []);
  const [job] = queue.getSnapshot();
  assert.equal(job.ownerId, 'owner-a');
  assert.match(job.message, /Sign back into the account/);
});

test('required first-post onboarding waits for server-side publish completion', async () => {
  const queue = createPublishQueue();
  const gate = deferred();
  const id = queue.enqueue('new-member', 'first DVNT post', async () => gate.promise);
  let complete = false;
  const done = queue.whenFinished(id).then(() => { complete = true; });
  await tick();
  assert.equal(complete, false, 'an enqueued post must NOT unlock onboarding');
  gate.resolve();
  await done;
  assert.equal(complete, true, 'successful completion unlocks next status read');
  assert.deepEqual(queue.getSnapshot(), []);
});

test('failed first-post publish keeps the member on the composer', async () => {
  const queue = createPublishQueue();
  const id = queue.enqueue('new-member', 'first DVNT post', async () => {
    throw new Error('Upload could not finish');
  });
  await assert.rejects(queue.whenFinished(id), /Upload could not finish/);
  const saved = queue.getSnapshot().find((job) => job.id === id);
  assert.equal(saved?.status, 'failed');
});

test('invalid media captions are refused before local copies, uploads or API writes, including resumed jobs', async () => {
  let copies = 0;
  const { published, uploads, deps } = recorder({ persistMedia: async (file) => { copies++; return file; } });
  const task = createPublishTask(draft({ content: 'x'.repeat(2201) + ' #music' }), 'owner-a', deps);
  await assert.rejects(() => task(() => {}, () => {}), /excluding hashtags/);
  assert.equal(copies, 0);
  assert.deepEqual(uploads, []);
  assert.deepEqual(published, []);
});
test('media publish preserves inline hashtags beyond raw 2200 characters and keeps people tags separate', async () => {
  const content = 'x'.repeat(2200) + '\n#Café #東京';
  const sent: Array<Parameters<PublishTaskDeps["createPost"]>[0]> = [];
  let people;
  const { deps } = recorder({
    createPost: async (input) => { sent.push(input); return { id: 77 }; },
    addPlacedTags: (postId, tags) => { people = { postId, tags }; },
  });
  const placedTags = [{ userId: 9, x: 0.2, y: 0.5, mediaIndex: 0 }];
  await createPublishTask(draft({ content, placedTags }), 'owner-a', deps)(() => {}, () => {});
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, content);
  assert.deepEqual(people, { postId: '77', tags: placedTags });
});

test('Live Photo arrays retain original pairs and ordering across persisted upload and retry', async () => {
  const { uploadLivePhotoPair } = await import('../media/live-photo-upload.ts');
  const files = [0, 1, 2, 3].map((index) => ({
    uri: `file:///original-${index}.heic`, type: 'image' as const,
    kind: 'livePhoto', mimeType: 'image/heic', pairedVideoUri: `file:///original-${index}.mov`,
  }));
  let saved = draft({ files, uploaded: files.map(() => null) });
  const actualUploads: string[] = [];
  let failSecondMotion = true;
  let published: PublishDescriptor['uploaded'] | undefined;
  const { deps } = recorder({
    persistMedia: async (file) => ({ ...file }),
    uploadMedia: async (pending) => Promise.all(pending.map(async (file) => {
      const result = await uploadLivePhotoPair(file, async (uri) => {
        actualUploads.push(uri);
        if (failSecondMotion && uri === files[1].pairedVideoUri) return { success: false, url: '' };
        return { success: true, url: uri.replace('file:///', 'https://cdn.test/') };
      });
      return result.success ? result : { error: result.error };
    })),
    createPost: async (input) => { published = input.media; return { id: 673 }; },
  });
  await assert.rejects(createPublishTask(saved, 'owner-a', deps)(() => {}, next => { saved = next; }));
  assert.equal(published, undefined, 'never publishes a flattened partial pair');
  assert.equal(saved.uploaded[1], null);
  assert.ok(saved.uploaded[0]?.livePhotoVideoUrl);
  // Simulate process death: serialization must preserve both remaining input
  // pairs and already uploaded outputs, not merely the image URLs.
  saved = JSON.parse(JSON.stringify(saved));
  failSecondMotion = false;
  actualUploads.length = 0;
  await createPublishTask(saved, 'owner-a', deps)(() => {}, next => { saved = next; });
  assert.deepEqual(actualUploads, [files[1].uri, files[1].pairedVideoUri]);
  assert.deepEqual(published?.map(media => media?.url), files.map(file => file.uri.replace('file:///', 'https://cdn.test/')));
  assert.deepEqual(published?.map(media => media?.livePhotoVideoUrl), files.map(file => file.pairedVideoUri.replace('file:///', 'https://cdn.test/')));
});
