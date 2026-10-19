/**
 * The upload edge function permits ten requests per minute, not ten files.
 * One Live Photo consumes two requests. Keep browser requests serial and retry
 * only an explicit refusal made before upload, never an uncertain network or
 * storage error that might already have written an object.
 */
export const UPLOAD_RATE_MESSAGE = "Too many uploads. Try again shortly.";
export const UPLOAD_RATE_WINDOW_MS = 60_000;
export const MAX_UPLOAD_RATE_WAIT_MS = 120_000;

interface UploadResponse {
  data?: { ok?: boolean; error?: unknown } | null;
  error?: { context?: unknown } | null;
  response?: { status: number; headers: { get(name: string): string | null } };
}

export function uploadRateDelay(result: UploadResponse, now = Date.now()): number | null {
  const response = result.response ?? result.error?.context as UploadResponse["response"];
  if (response?.status !== 429 && !(result.data?.ok === false && result.data.error === UPLOAD_RATE_MESSAGE)) return null;
  const header = response?.headers?.get("Retry-After")?.trim();
  let delay = UPLOAD_RATE_WINDOW_MS;
  if (header) {
    const seconds = Number(header);
    const timestamp = Date.parse(header);
    if (Number.isFinite(seconds) && seconds >= 0) delay = seconds * 1000;
    else if (!Number.isFinite(seconds) && Number.isFinite(timestamp)) delay = Math.max(0, timestamp - now);
  }
  // A longer server instruction must not be truncated into an early retry.
  if (delay > MAX_UPLOAD_RATE_WAIT_MS) return null;
  return Math.max(1000, Math.ceil(delay));
}

export function createWebUploadScheduler(deps: {
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
} = {}) {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
  let tail = Promise.resolve();
  let pending = 0;
  return async function schedule<T extends UploadResponse>(
    upload: () => Promise<T>,
    onStatus?: (message: string) => void,
  ): Promise<T> {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => { release = resolve; });
    const queued = pending++ > 0;
    try {
      if (queued) onStatus?.("Waiting for the earlier media upload…");
      await previous;
      if (queued) onStatus?.("Uploading your media…");
      const result = await upload();
      const delay = uploadRateDelay(result, now());
      if (delay == null) return result;
      onStatus?.(`Upload limit reached. Retrying in ${Math.ceil(delay / 1000)} seconds. Keep this tab open…`);
      await sleep(delay);
      onStatus?.("Retrying your media upload…");
      // One retry only. Another refusal stays a normal, retryable queue failure.
      return await upload();
    } finally {
      pending--;
      release();
    }
  };
}

export const scheduleWebUpload = createWebUploadScheduler();
