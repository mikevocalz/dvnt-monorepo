/** Expo's iOS Live Photo bridge requires file URLs for both original resources. */
export interface NativeLivePhotoSource {
  photoUri: string;
  pairedVideoUri: string;
}

export interface LivePhotoResourceLease {
  source: Promise<NativeLivePhotoSource>;
  release(discard?: boolean): void;
}

interface DownloadTask {
  downloadAsync(): Promise<{ uri: string; status: number } | undefined>;
  cancelAsync(): Promise<void>;
}
interface ResourceFileSystem {
  cacheDirectory: string | null;
  makeDirectoryAsync(uri: string, options: { intermediates: boolean }): Promise<void>;
  readDirectoryAsync?(uri: string): Promise<string[]>;
  deleteAsync(uri: string, options: { idempotent: boolean }): Promise<void>;
  getInfoAsync(uri: string): Promise<{ exists: boolean; size?: number; isDirectory?: boolean }>;
  createDownloadResumable(
    uri: string,
    destination: string,
    options: object,
    progress: (event: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
  ): DownloadTask;
}
interface CacheOptions {
  maxPairs?: number;
  maxBytes?: number;
  maxPairBytes?: number;
  downloadTimeoutMs?: number;
  cancellationTimeoutMs?: number;
}

export function localLivePhotoUri(uri: string): string | null {
  if (/^file:\/\/\//i.test(uri)) return uri;
  if (uri.startsWith("/") && !uri.startsWith("//")) {
    const url = new URL("file:///");
    url.pathname = uri;
    return url.href;
  }
  return null;
}

export function localLivePhotoSource(photoUri: string, videoUri?: string): NativeLivePhotoSource | null {
  const photo = localLivePhotoUri(photoUri);
  const video = videoUri ? localLivePhotoUri(videoUri) : null;
  return photo && video ? { photoUri: photo, pairedVideoUri: video } : null;
}

export function isLivePhotoResourceUri(uri?: string): uri is string {
  return !!uri && (!!localLivePhotoUri(uri) || /^https?:\/\//i.test(uri));
}

function extension(uri: string, kind: "photo" | "video") {
  const match = uri.split(/[?#]/, 1)[0]?.match(/\.([a-z0-9]+)$/i);
  const value = match?.[1]?.toLowerCase();
  const allowed = kind === "photo" ? ["heic", "heif", "jpg", "jpeg", "png"] : ["mov", "mp4", "m4v"];
  return value && allowed.includes(value) ? value : kind === "photo" ? "heic" : "mov";
}

// Keep live roots across module refresh. Startup pruning may remove an old
// app session, but never another cache object with active native consumers.
const runtime = globalThis as typeof globalThis & { __dvntLivePhotoCacheRoots?: Set<string> };
const liveCacheRoots = runtime.__dvntLivePhotoCacheRoots ??= new Set<string>();

/**
 * Original bytes only: never image-manipulate, transcode, or delete picker files.
 * At most eight pairs / 128 MiB are retained, with one bounded download at a
 * time. In-use leases are pinned; if the budget is full, the caller uses its
 * ordinary video fallback instead of evicting resources beneath a native view.
 */
export function createLivePhotoResourceCache(fs: ResourceFileSystem, options: CacheOptions = {}) {
  const maxPairs = options.maxPairs ?? 8;
  const maxBytes = options.maxBytes ?? 128 * 1024 * 1024;
  const maxPairBytes = Math.min(options.maxPairBytes ?? 64 * 1024 * 1024, maxBytes);
  const downloadTimeoutMs = options.downloadTimeoutMs ?? 15_000;
  const cancellationTimeoutMs = options.cancellationTimeoutMs ?? 2_000;
  const base = fs.cacheDirectory ? `${fs.cacheDirectory}dvnt-live-photo-pairs-v1/` : null;
  // Native URLSession completions can outlive cancellation or a JS refresh.
  // A late old cleanup must never address a newer cache instance's files.
  const namespace = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const root = base ? `${base}${namespace}/` : null;
  if (root) liveCacheRoots.add(root);
  type Entry = {
    key: string; directory: string; refs: number; bytes: number; ready: boolean;
    cancelled: boolean; invalidated: boolean; touched: number; cancel?: () => void;
    promise: Promise<NativeLivePhotoSource>;
  };
  const entries = new Map<string, Entry>();
  let counter = 0;
  let bytes = 0;
  let disabled = false;
  let initialization: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const removeFiles = async (directory: string) => {
    try { await fs.deleteAsync(directory, { idempotent: true }); }
    catch (error) { disabled = true; throw error; }
  };
  const evict = async (entry: Entry) => {
    // Stop handing out this source before the first await. Another consumer
    // may acquire the same pair while native file deletion is still pending.
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    await removeFiles(entry.directory);
    bytes -= entry.bytes;
    entry.bytes = 0;
  };
  const idleEntries = (except: Entry) => [...entries.values()]
    .filter(entry => entry !== except && entry.ready && entry.refs === 0)
    .sort((a, b) => a.touched - b.touched);

  async function download(entry: Entry, uri: string, destination: string, limit: number) {
    let abortReason: Error | undefined;
    let cancelPromise: Promise<void> | undefined;
    let rejectAbort: (error: Error) => void = () => {};
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    let task: DownloadTask;
    const abort = (reason: string) => {
      if (abortReason) return;
      abortReason = new Error(reason);
      cancelPromise = Promise.resolve().then(() => task.cancelAsync()).catch(() => { disabled = true; });
      rejectAbort(abortReason);
    };
    task = fs.createDownloadResumable(uri, destination, {}, progress => {
      if (progress.totalBytesWritten > limit || progress.totalBytesExpectedToWrite > limit) {
        abort("Live Photo original exceeds the cache size limit");
      }
    });
    entry.cancel = () => abort("Live Photo resources no longer needed");
    const timer = setTimeout(() => abort("Live Photo original download timed out"), downloadTimeoutMs);
    const transfer = Promise.resolve().then(() => task.downloadAsync());
    try {
      const result = await Promise.race([transfer, aborted]);
      if (entry.cancelled || !result) throw new Error("Live Photo resource download cancelled");
      if (result.status < 200 || result.status >= 300 || result.uri !== destination) {
        throw new Error("Live Photo original download failed");
      }
      const info = await fs.getInfoAsync(destination);
      if (!info.exists || info.isDirectory || !Number.isFinite(info.size) || !info.size || info.size > limit) {
        throw new Error("Live Photo original is missing, empty, or too large");
      }
      return info.size;
    } finally {
      clearTimeout(timer);
      entry.cancel = undefined;
      if (abortReason) {
        let cancellationTimer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          cancelPromise,
          new Promise<void>(resolve => {
            cancellationTimer = setTimeout(() => { disabled = true; resolve(); }, cancellationTimeoutMs);
          }),
        ]);
        clearTimeout(cancellationTimer);
        // A native downloader can settle after cancellation. Its unique folder
        // cannot belong to a newer pair; remove any late partial write as well.
        void transfer.finally(() => removeFiles(entry.directory)).catch(() => {});
      }
    }
  }

  async function prepare(entry: Entry, photoUri: string, videoUri: string) {
    try {
      if (!root || disabled || entry.cancelled) throw new Error("Live Photo resource cache unavailable");
      initialization ??= (async () => {
        // Create this instance's namespace without deleting another live
        // instance's resources. Prune only cache-owned names left by prior
        // app sessions; unique paths isolate any late native transfer writes.
        await fs.makeDirectoryAsync(root, { intermediates: true });
        if (base && fs.readDirectoryAsync) {
          for (const name of await fs.readDirectoryAsync(base)) {
            if (!/^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/.test(name)) continue;
            const previousRoot = `${base}${name}/`;
            if (!liveCacheRoots.has(previousRoot)) await removeFiles(previousRoot);
          }
        }
      })();
      await initialization;
      if (entry.cancelled || disabled) throw new Error("Live Photo resources no longer needed");
      for (const idle of idleEntries(entry)) {
        if (entries.size <= maxPairs && bytes + maxPairBytes <= maxBytes) break;
        // Earlier deletions awaited native IO; a later candidate may have
        // acquired a new lease in the meantime. Never evict that live pair.
        if (idle.refs > 0 || entries.get(idle.key) !== idle) continue;
        await evict(idle);
      }
      if (entries.size > maxPairs || bytes + maxPairBytes > maxBytes) {
        throw new Error("Live Photo resource cache is in use");
      }
      await fs.makeDirectoryAsync(entry.directory, { intermediates: true });
      let ownedBytes = 0;
      const localize = async (uri: string, kind: "photo" | "video") => {
        if (entry.cancelled) throw new Error("Live Photo resources no longer needed");
        const local = localLivePhotoUri(uri);
        if (local) return local;
        const target = `${entry.directory}${kind}.${extension(uri, kind)}`;
        ownedBytes += await download(entry, uri, target, maxPairBytes - ownedBytes);
        return target;
      };
      const photo = await localize(photoUri, "photo");
      const video = await localize(videoUri, "video");
      if (entry.cancelled) throw new Error("Live Photo resources no longer needed");
      entry.bytes = ownedBytes;
      bytes += ownedBytes;
      entry.ready = true;
      return { photoUri: photo, pairedVideoUri: video };
    } catch (error) {
      if (entries.get(entry.key) === entry) entries.delete(entry.key);
      if (root) await removeFiles(entry.directory).catch(() => {});
      throw error;
    }
  }

  function acquire(photoUri: string, videoUri: string): LivePhotoResourceLease {
    const local = localLivePhotoSource(photoUri, videoUri);
    if (local) return { source: Promise.resolve(local), release() {} };
    if (!isLivePhotoResourceUri(photoUri) || !isLivePhotoResourceUri(videoUri)) {
      return { source: Promise.reject(new Error("Unsupported Live Photo resource URI")), release() {} };
    }
    const key = JSON.stringify([photoUri, videoUri]);
    let entry = entries.get(key);
    if (!entry) {
      // Bound even the waiting queue; idle entries can be evicted by prepare.
      if ([...entries.values()].filter(item => !item.ready || item.refs > 0).length >= maxPairs) {
        return { source: Promise.reject(new Error("Live Photo resource cache is in use")), release() {} };
      }
      entry = {
        key, directory: `${root ?? ""}${++counter}/`, refs: 0, bytes: 0,
        ready: false, cancelled: false, invalidated: false, touched: counter,
        promise: Promise.resolve({ photoUri: "", pairedVideoUri: "" }),
      };
      entries.set(key, entry);
      const current = entry;
      entry.promise = queue.then(() => prepare(current, photoUri, videoUri));
      queue = entry.promise.catch(() => {});
    }
    entry.refs++;
    entry.touched = ++counter;
    let released = false;
    return {
      source: entry.promise,
      release(discard = false) {
        if (released) return;
        released = true;
        entry.refs--;
        if (discard) entry.invalidated = true;
        if (!entry.refs && entry.ready && entry.invalidated) {
          if (entries.get(key) === entry) entries.delete(key);
          queue = queue.then(() => evict(entry)).catch(() => {});
        }
        if (!entry.refs && !entry.ready) {
          entry.cancelled = true;
          entry.cancel?.();
          if (entries.get(key) === entry) entries.delete(key);
        }
      },
    };
  }
  function clear(): Promise<void> {
    // Invalidate lookup synchronously on logout/account switch. The queue
    // drains cancellations before deleting this instance's owned directories;
    // later acquisitions queue behind cleanup and use fresh, never-reused IDs.
    const previous = [...entries.values()];
    entries.clear();
    for (const entry of previous) {
      entry.cancelled = true;
      entry.cancel?.();
    }
    const cleanup = queue.then(async () => {
      for (const entry of previous) await evict(entry);
      if (root) await removeFiles(root);
    });
    queue = cleanup.catch(() => {});
    return cleanup;
  }
  return { acquire, clear };
}
