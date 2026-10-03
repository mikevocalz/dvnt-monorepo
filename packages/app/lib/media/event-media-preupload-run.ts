// Pure upload loop for event media pre-upload. Kept free of React and
// native imports so node:test can drive it; the hook supplies the deps.

export type PreuploadSlot = "flyer" | "poster" | "gallery";

export interface PreuploadItem {
  uri: string;
  slot: PreuploadSlot;
  mediaType: "image" | "video";
}

export interface PreuploadJobView {
  state: "queued" | "uploading" | "uploaded" | "failed";
  attempts: number;
}

export interface PreuploadDeps {
  getJob: (uri: string) => PreuploadJobView | undefined;
  patch: (uri: string, values: Record<string, unknown>) => void;
  /** Turns a picker URI into one that survives the picker's temp cleanup. */
  persist: (item: PreuploadItem) => Promise<string>;
  upload: (
    uri: string,
    item: PreuploadItem,
    onProgress: (percentage: number) => void,
  ) => Promise<{ success: boolean; url?: string; error?: string }>;
  onProgress?: (item: PreuploadItem, percentage: number) => void;
  /** Writes the CDN URL into the event draft if the slot still holds `uri`. */
  bank: (item: PreuploadItem, url: string) => void;
}

/**
 * Uploads every queued (or once-failed) item, one at a time.
 *
 * `isCancelled` only stops the loop from starting another upload. An upload
 * that already started always records its outcome: the job store and the
 * draft outlive the effect that launched it, and a job left in "uploading"
 * is skipped by every later run, so its CDN URL would never be banked.
 */
export async function runEventMediaPreupload(
  items: readonly PreuploadItem[],
  deps: PreuploadDeps,
  isCancelled: () => boolean,
): Promise<void> {
  for (const item of items) {
    if (isCancelled()) return;
    const current = deps.getJob(item.uri);
    if (!current || (current.state !== "queued" && current.state !== "failed")) continue;
    // Do not spin forever on a permanent server rejection. The explicit
    // retry action can move a failed job back to queued.
    if (current.state === "failed" && current.attempts >= 2) continue;

    deps.patch(item.uri, {
      state: "uploading",
      attempts: current.attempts + 1,
      error: undefined,
    });
    try {
      const durableUri = await deps.persist(item);
      const result = await deps.upload(durableUri, item, (percentage) => {
        deps.patch(item.uri, { progress: percentage });
        deps.onProgress?.(item, percentage);
      });
      if (!result.success || !result.url) {
        throw new Error(result.error || "Media upload failed");
      }
      deps.patch(item.uri, {
        state: "uploaded",
        progress: 100,
        remoteUrl: result.url,
        error: undefined,
      });
      deps.bank(item, result.url);
    } catch (error) {
      deps.patch(item.uri, {
        state: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "Media upload failed",
      });
    }
  }
}
