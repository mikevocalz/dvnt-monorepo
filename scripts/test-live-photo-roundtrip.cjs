#!/usr/bin/env node
// No sockets, real user data or credentials. Real multipart serialization and
// real PostgreSQL/WASM persistence; media decoding belongs to the browser test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');
const { createHarness, clientAdapters, root, digest } = require('./fixtures/live-photo-roundtrip/harness.cjs');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-photo-roundtrip-'));
  const harness = await createHarness();
  const realFetch = global.fetch;
  const objectUrls = [];
  try {
    global.fixtureOrigin = 'https://live-photo-fixture.invalid';
    global.fetch = async (url, init) => {
      const request = new Request(url, init);
      if (request.url.startsWith('blob:')) return realFetch(request);
      assert.equal(new URL(request.url).origin, global.fixtureOrigin, 'all external network access is forbidden');
      // Force multipart and JSON through actual encoded bytes, not object mocks.
      return harness.handle(new Request(request.url, { method: request.method, headers: request.headers, ...(request.method === 'GET' ? {} : { body: await request.arrayBuffer() }) }));
    };
    await build({ entryPoints: [path.join(__dirname, 'fixtures/live-photo-roundtrip/client.ts')], bundle: true, outfile: path.join(directory, 'client.cjs'), platform: 'node', format: 'cjs', plugins: [clientAdapters()], alias: { '@dvnt/app': path.join(root, 'packages/app') }, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean) });
    const client = require(path.join(directory, 'client.cjs'));
    const originals = [];
    const files = [];
    for (let index = 0; index < 3; index++) {
      // Synthetic opaque originals prove untouched binary roundtripping even
      // with zero bytes and non-ASCII bytes. No claim of Node media decoding.
      const still = Buffer.from([0xff, 0xd8, 0x00, index, 0xff, 0x65, 0x00]);
      const motion = Buffer.concat([Buffer.from('synthetic-ftypqt-pair-'), Buffer.from([0, index, 0xff, 0x80])]);
      originals.push({ still, motion });
      const pair = await client.createBrowserLivePhotoAsset(new File([still], `IMG_${index}.jpg`, { type: 'image/jpeg' }), new File([motion], `IMG_${index}.mov`, { type: 'video/quicktime' }), { readDuration: async () => 2 });
      assert.equal(pair.ok, true);
      files.push(pair.asset); objectUrls.push(pair.asset.uri, pair.asset.pairedVideoUri);
    }
    client.prepare(files, 'fixture-pair-array');
    await client.publish();
    const created = client.state.created;
    assert.ok(created?.id);
    assert.deepEqual(await harness.counts(), { posts: 1, media: 3, requests: 1 });
    assert.equal(harness.state.uploads.length, 6);
    const stored = await harness.db.query('SELECT * FROM posts_media ORDER BY _order');
    assert.deepEqual(stored.rows.map(row => row._order), [0, 1, 2]);
    for (let index = 0; index < files.length; index++) {
      const row = stored.rows[index];
      assert.equal(row.type, 'image'); assert.equal(row.mime_type, 'image/jpeg');
      assert.ok(row.live_photo_video_url, 'a Live Photo cannot become a flattened still');
      const stillObject = harness.state.objects.get(new URL(row.url).pathname);
      const motionObject = harness.state.objects.get(new URL(row.live_photo_video_url).pathname);
      assert.equal(stillObject.sha256, digest(originals[index].still));
      assert.equal(motionObject.sha256, digest(originals[index].motion));
      assert.equal(motionObject.mime, 'video/quicktime'); assert.match(motionObject.filename, /\.mov$/);
    }
    const read = await client.read(created.id);
    assert.deepEqual(JSON.parse(JSON.stringify(read.media)), JSON.parse(JSON.stringify(created.media)), 'optimistic post and fresh persisted read must agree after unordered DB rows');
    assert.equal(harness.state.reads.length, 1);
    for (let index = 0; index < read.media.length; index++) {
      assert.equal(read.media[index].type, 'livePhoto');
      const source = client.resolveWebPostMedia(read.media[index]);
      assert.equal(source.videoUrl, stored.rows[index].live_photo_video_url);
      assert.equal(source.posterUrl, stored.rows[index].url);
    }
    const originalCreates = harness.state.creates.length;
    const originalUploads = harness.state.uploads.length;
    client.prepare([{ ...files[0], pairedVideoUri: undefined }], 'fixture-missing-pair');
    await assert.rejects(client.publish(), /video is missing/);
    assert.equal(harness.state.creates.length, originalCreates);
    assert.equal(harness.state.uploads.length, originalUploads, 'missing motion fails before even uploading still');
    assert.deepEqual(await harness.counts(), { posts: 1, media: 3, requests: 1 });

    client.prepare([files[0]], 'fixture-upload-retry');
    harness.state.failMotion = true;
    await assert.rejects(client.publish(), /motion upload failure/);
    assert.equal(client.state.descriptor.uploaded[0], null, 'failed motion must not cache a successful still as a complete pair');
    assert.equal(harness.state.creates.length, originalCreates);
    assert.deepEqual(await harness.counts(), { posts: 1, media: 3, requests: 1 });
    harness.state.failMotion = false;
    await client.publish();
    assert.deepEqual(await harness.counts(), { posts: 2, media: 4, requests: 2 });
    assert.equal(client.state.created.media[0].type, 'livePhoto');

    // Simulate an acknowledgement lost AFTER the real SQL transaction committed.
    client.prepare([files[1]], 'fixture-lost-response');
    harness.state.loseCreateAcknowledgement = true;
    await assert.rejects(client.publish());
    assert.deepEqual(await harness.counts(), { posts: 3, media: 5, requests: 3 });
    const uploadedBeforeRetry = harness.state.uploads.length;
    await client.publish();
    assert.equal(harness.state.uploads.length, uploadedBeforeRetry, 'retry must reuse the already uploaded complete pair');
    assert.deepEqual(await harness.counts(), { posts: 3, media: 5, requests: 3 }, 'lost acknowledgement retry must not create a duplicate');
    assert.equal((await client.read(client.state.created.id)).media[0].type, 'livePhoto');
    console.log('PASS real browser pair helper → original multipart bytes → create-post edge → checked-in PostgreSQL migrations → fresh postsApi read → renderer source; ordered arrays, missing/failed motion refusal, upload retry and lost-response idempotency. Identity/admission and media-upload/storage endpoint are test adapters; no media decoding claimed.');
  } finally {
    global.fetch = realFetch; delete global.fixtureOrigin;
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    await harness.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
