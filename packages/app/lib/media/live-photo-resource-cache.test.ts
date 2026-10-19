import assert from "node:assert/strict";
import { test } from "node:test";
import { createLivePhotoResourceCache, localLivePhotoSource, isLivePhotoResourceUri } from "./live-photo-resource-cache.ts";

function fileSystem() {
  const files = new Map<string, Uint8Array>();
  const remotes = new Map<string, { bytes: Uint8Array; status?: number; held?: boolean; ignoreCancel?: boolean }>();
  const downloads: { uri: string; target: string; cancelled: number; progress: (written: number, expected: number) => void; finish: () => void }[] = [];
  const removed: string[] = [];
  const fs = {
    cacheDirectory: "file:///cache/",
    async makeDirectoryAsync() {},
    async deleteAsync(uri: string) {
      removed.push(uri);
      for (const file of files.keys()) if (file === uri || file.startsWith(uri.endsWith("/") ? uri : `${uri}/`)) files.delete(file);
    },
    async getInfoAsync(uri: string) {
      const bytes = files.get(uri);
      return { exists: !!bytes, size: bytes?.byteLength, isDirectory: false };
    },
    createDownloadResumable(uri: string, target: string, _options: object, progress: (event: any) => void) {
      const remote = remotes.get(uri);
      if (!remote) throw new Error("Unknown fake URL");
      let complete: (result: any) => void = () => {};
      const task = {
        uri, target, cancelled: 0,
        progress: (written: number, expected: number) => progress({ totalBytesWritten: written, totalBytesExpectedToWrite: expected }),
        finish() {
          files.set(target, remote.bytes.slice());
          complete({ uri: target, status: remote.status ?? 200 });
        },
      };
      downloads.push(task);
      return {
        downloadAsync: () => new Promise<any>(resolve => {
          complete = resolve;
          if (!remote.held) task.finish();
        }),
        async cancelAsync() {
          task.cancelled++;
          if (!remote.ignoreCancel) complete(undefined);
        },
      };
    },
  };
  const pair = (id: string, size = 10, options: { held?: boolean; ignoreCancel?: boolean; status?: number } = {}) => {
    const photo = `https://cdn/${id}.heic`, video = `https://cdn/${id}.mov`;
    remotes.set(photo, { bytes: Uint8Array.from({ length: size }, (_, i) => i % 255), ...options });
    remotes.set(video, { bytes: Uint8Array.from({ length: size }, (_, i) => 255 - i % 255), ...options });
    return [photo, video] as const;
  };
  return { fs, files, remotes, downloads, removed, pair };
}
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

test("picker file pairs bypass downloading and preserve original URIs/ownership", async () => {
  const mock = fileSystem();
  const cache = createLivePhotoResourceCache(mock.fs);
  mock.files.set("file:///picker/IMG.heic", new Uint8Array([1, 2, 3]));
  const lease = cache.acquire("file:///picker/IMG.heic", "file:///picker/IMG.mov");
  assert.deepEqual(await lease.source, { photoUri: "file:///picker/IMG.heic", pairedVideoUri: "file:///picker/IMG.mov" });
  lease.release(true);
  assert.equal(mock.downloads.length, 0);
  assert.equal(mock.removed.length, 0);
  assert.ok(mock.files.has("file:///picker/IMG.heic"));
  assert.deepEqual(localLivePhotoSource("/picker/a #1.heic", "/picker/a.mov"), { photoUri: "file:///picker/a%20%231.heic", pairedVideoUri: "file:///picker/a.mov" });
  assert.equal(isLivePhotoResourceUri("ph://unresolved-library-id"), false);
});

test("remote originals are deduplicated and both become file URLs without changing bytes", async () => {
  const mock = fileSystem();
  const cache = createLivePhotoResourceCache(mock.fs);
  const pair = mock.pair("original");
  const first = cache.acquire(...pair), second = cache.acquire(...pair);
  assert.strictEqual(first.source, second.source);
  const source = await first.source;
  assert.match(source.photoUri, /^file:\/\/\/cache\/dvnt-live-photo-pairs-v1\/[a-z0-9-]+\/\d+\/photo.heic$/);
  assert.match(source.pairedVideoUri, /\/video.mov$/);
  assert.equal(mock.downloads.length, 2);
  assert.deepEqual(mock.files.get(source.photoUri), mock.remotes.get(pair[0])!.bytes);
  assert.deepEqual(mock.files.get(source.pairedVideoUri), mock.remotes.get(pair[1])!.bytes);
  first.release(); second.release();
  const again = cache.acquire(...pair);
  assert.deepEqual(await again.source, source);
  assert.equal(mock.downloads.length, 2, "cached original bytes are reused");
  again.release();
});

test("mixed local/remote pair downloads only its remote resource", async () => {
  const mock = fileSystem(); const cache = createLivePhotoResourceCache(mock.fs);
  const pair = mock.pair("mixed");
  const lease = cache.acquire("file:///picker/original.heic", pair[1]);
  assert.equal((await lease.source).photoUri, "file:///picker/original.heic");
  assert.deepEqual(mock.downloads.map(item => item.uri), [pair[1]]);
  lease.release(true); await flush();
  assert.ok(mock.removed.every(uri => uri.startsWith("file:///cache/dvnt-live-photo-pairs-v1/")));
});

test("bounded cache evicts idle pairs, never a leased pair, and refuses excess pinned work", async () => {
  const mock = fileSystem();
  const cache = createLivePhotoResourceCache(mock.fs, { maxPairs: 2, maxBytes: 256, maxPairBytes: 128 });
  const a = cache.acquire(...mock.pair("a")); const aSource = await a.source; a.release();
  const b = cache.acquire(...mock.pair("b")); const bSource = await b.source;
  const c = cache.acquire(...mock.pair("c")); await c.source;
  assert.equal(mock.files.has(aSource.photoUri), false);
  assert.equal(mock.files.has(bSource.photoUri), true);
  const d = cache.acquire(...mock.pair("d"));
  await assert.rejects(d.source, /cache is in use/);
  assert.equal(mock.downloads.length, 6);
  b.release(); c.release();
});

test("download timeout, non-success HTTP, and over-budget originals never reach native", async () => {
  for (const failure of ["timeout", "http", "size"] as const) {
    const mock = fileSystem();
    const pair = mock.pair(failure, failure === "size" ? 20 : 10, failure === "timeout" ? { held: true } : failure === "http" ? { status: 403 } : {});
    const cache = createLivePhotoResourceCache(mock.fs, { downloadTimeoutMs: 10, maxPairBytes: 30 });
    const lease = cache.acquire(...pair);
    await assert.rejects(lease.source);
    await flush();
    assert.equal(mock.files.size, 0, `${failure} removes partial original files`);
    if (failure === "timeout") assert.equal(mock.downloads[0].cancelled, 1);
    lease.release();
  }
});

test("progress rejects an announced oversized download before consuming the entire file", async () => {
  const mock = fileSystem(); const pair = mock.pair("huge", 10, { held: true });
  const cache = createLivePhotoResourceCache(mock.fs, { maxPairBytes: 30 });
  const lease = cache.acquire(...pair); const failure = assert.rejects(lease.source, /size limit/);
  await flush(); mock.downloads[0].progress(1, 1000); await failure;
  assert.equal(mock.downloads[0].cancelled, 1); assert.equal(mock.files.size, 0);
});

test("last consumer cancellation cleans even late native writes and never affects a newer pair", async () => {
  const mock = fileSystem(); const pair = mock.pair("cancel", 10, { held: true, ignoreCancel: true });
  const cache = createLivePhotoResourceCache(mock.fs);
  const first = cache.acquire(...pair), second = cache.acquire(...pair);
  const failure = assert.rejects(first.source, /no longer needed/);
  await flush(); first.release(); assert.equal(mock.downloads[0].cancelled, 0);
  second.release(); await failure; assert.equal(mock.downloads[0].cancelled, 1);
  const next = cache.acquire(...mock.pair("next")); const nextSource = await next.source;
  mock.downloads[0].finish(); await flush();
  assert.equal(mock.files.has(mock.downloads[0].target), false, "late completion is removed");
  assert.equal(mock.files.has(nextSource.photoUri), true, "old cleanup cannot delete the newer pair");
  next.release();
});

test("native rejection discards only cache-owned copies so a repaired URL can retry", async () => {
  const mock = fileSystem(); const pair = mock.pair("repair"); const cache = createLivePhotoResourceCache(mock.fs);
  const lease = cache.acquire(...pair); const source = await lease.source;
  lease.release(true); await flush(); assert.equal(mock.files.has(source.photoUri), false);
  const retry = cache.acquire(...pair); await retry.source;
  assert.equal(mock.downloads.length, 4); retry.release();
});

test("a pair cannot be repinned while its native cache deletion is pending", async () => {
  const mock = fileSystem(); const cache = createLivePhotoResourceCache(mock.fs, { maxPairs: 1 });
  const pair = mock.pair("evicting"); const first = cache.acquire(...pair);
  const source = await first.source; first.release();
  const directory = source.photoUri.slice(0, source.photoUri.lastIndexOf("/") + 1);
  let resume: () => void = () => {};
  const remove = mock.fs.deleteAsync;
  mock.fs.deleteAsync = async uri => {
    if (uri === directory) await new Promise<void>(resolve => { resume = resolve; });
    await remove(uri);
  };
  const next = cache.acquire(...mock.pair("new")); await flush();
  const repinned = cache.acquire(...pair);
  await assert.rejects(repinned.source, /cache is in use/, "must not return a lease to the files being deleted");
  resume(); await next.source;
  assert.equal(mock.files.has(source.photoUri), false);
  next.release();
});

test("a later LRU candidate pinned during another deletion is rechecked and preserved", async () => {
  const mock = fileSystem();
  const cache = createLivePhotoResourceCache(mock.fs, { maxPairs: 3, maxBytes: 80, maxPairBytes: 50 });
  const a = cache.acquire(...mock.pair("small", 5)); const aSource = await a.source; a.release();
  const pairB = mock.pair("large", 20); const b = cache.acquire(...pairB); const bSource = await b.source; b.release();
  const directory = aSource.photoUri.slice(0, aSource.photoUri.lastIndexOf("/") + 1);
  let resume: () => void = () => {};
  const remove = mock.fs.deleteAsync;
  mock.fs.deleteAsync = async uri => {
    if (uri === directory) await new Promise<void>(resolve => { resume = resolve; });
    await remove(uri);
  };
  const next = cache.acquire(...mock.pair("new", 20));
  const failure = assert.rejects(next.source, /cache is in use/);
  await flush(); const repinned = cache.acquire(...pairB); await repinned.source;
  resume(); await failure;
  assert.equal(mock.files.has(bSource.photoUri), true, "newly pinned idle candidate survives the resumed eviction loop");
  repinned.release();
});

test("old cancelled transfers cannot remove a newer cache instance's resources", async () => {
  const mock = fileSystem(); const old = createLivePhotoResourceCache(mock.fs);
  const previous = old.acquire(...mock.pair("previous", 10, { held: true, ignoreCancel: true }));
  const failure = assert.rejects(previous.source, /no longer needed/);
  await flush(); previous.release(); await failure;
  const replacement = createLivePhotoResourceCache(mock.fs);
  const lease = replacement.acquire(...mock.pair("new-instance")); const source = await lease.source;
  assert.notEqual(mock.downloads[0].target, source.photoUri);
  mock.downloads[0].finish(); await flush();
  assert.equal(mock.files.has(source.photoUri), true);
  assert.equal(mock.files.has(source.pairedVideoUri), true);
  lease.release();
});

test("creating another cache does not remove a live instance's leased originals", async () => {
  const mock = fileSystem(); const first = createLivePhotoResourceCache(mock.fs);
  const a = first.acquire(...mock.pair("leased")); const source = await a.source;
  const second = createLivePhotoResourceCache(mock.fs);
  const b = second.acquire(...mock.pair("other-runtime")); await b.source;
  assert.equal(mock.files.has(source.photoUri), true);
  a.release(); b.release(); await first.clear(); await second.clear();
});

test("account reset cancels pending work and invalidates lookup before new acquisitions", async () => {
  const mock = fileSystem(); const cache = createLivePhotoResourceCache(mock.fs);
  const pair = mock.pair("account"); const first = cache.acquire(...pair); const oldSource = await first.source;
  const pending = cache.acquire(...mock.pair("pending-account", 10, { held: true, ignoreCancel: true }));
  const failure = assert.rejects(pending.source, /no longer needed/);
  await flush(); const reset = cache.clear();
  const fresh = cache.acquire(...pair); const source = await fresh.source;
  await failure; await reset;
  assert.equal(mock.files.has(oldSource.photoUri), false);
  assert.notEqual(source.photoUri, oldSource.photoUri);
  assert.equal(mock.files.has(source.photoUri), true);
  mock.downloads[2].finish(); await flush();
  assert.equal(mock.files.has(source.photoUri), true, "old account's late cleanup never deletes new account files");
  first.release(); pending.release(); fresh.release(); await cache.clear();
  assert.equal(mock.files.size, 0);
});

test("startup pruning removes old app-session caches but not another live namespace", async () => {
  const mock = fileSystem();
  const fsWithListing = {
    ...mock.fs,
    async readDirectoryAsync(base: string) {
      return [...new Set([...mock.files.keys()].filter(uri => uri.startsWith(base)).map(uri => uri.slice(base.length).split("/")[0]))];
    },
  };
  const stale = "file:///cache/dvnt-live-photo-pairs-v1/old-session-123/1/photo.heic";
  mock.files.set(stale, new Uint8Array([1]));
  mock.files.set("file:///picker/original.heic", new Uint8Array([7]));
  const live = createLivePhotoResourceCache(fsWithListing);
  const a = live.acquire(...mock.pair("keep-live")); const source = await a.source;
  assert.equal(mock.files.has(stale), false);
  const replacement = createLivePhotoResourceCache(fsWithListing);
  const b = replacement.acquire(...mock.pair("keep-new")); await b.source;
  assert.equal(mock.files.has(source.photoUri), true);
  assert.equal(mock.files.has("file:///picker/original.heic"), true);
  a.release(); b.release(); await live.clear(); await replacement.clear();
});
