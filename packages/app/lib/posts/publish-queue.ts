/**
 * Foreground publishing that survives app termination.
 *
 * A job persists a serializable descriptor, never its closure, so an
 * interrupted publish is rebuilt from storage and retried on the next launch.
 * The descriptor carries the operation id and any media already uploaded, so a
 * resumed job replays the same payload and the server reconciles it to the post
 * the killed attempt may already have created instead of adding a second one.
 *
 * ponytail: bytes stop moving the moment the process dies. Transferring while
 * the app is not running needs a native background uploader (iOS URLSession
 * background configuration, Android WorkManager); this is resume-on-next-launch
 * only.
 */
import type { PublishDescriptor, PublishTask } from "./publish-descriptor.ts";

export type { PublishDescriptor, PublishTask };

export interface PublishJob {
  id: string;
  ownerId: string;
  label: string;
  status: "queued" | "running" | "failed";
  message: string;
  /** Rebuilt from storage because the app was killed mid-publish. */
  resumed?: boolean;
}
type Task = PublishTask;

/** Synchronous key/value store. MMKV on native, localStorage on web. */
export interface PublishQueueStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface PublishQueueConfig {
  storage: PublishQueueStorage;
  /**
   * Rebuild the work for a descriptor read back from storage. Attached once
   * the screen that can run it is mounted; until then jobs still persist.
   */
  build?: (descriptor: PublishDescriptor, ownerId: string) => Task;
  /** Delete the app-storage copies a settled job owned. */
  release?: (descriptor: PublishDescriptor) => void;
}

interface StoredJob {
  id: string;
  ownerId: string;
  label: string;
  descriptor: PublishDescriptor;
}

const STORAGE_KEY = "post-publish-queue";
const MAX_PENDING = 5;

export function createPublishQueue() {
  let jobs: PublishJob[] = [];
  let running = false;
  let sequence = 0;
  let config: PublishQueueConfig | null = null;
  const tasks = new Map<string, Task>();
  const descriptors = new Map<string, PublishDescriptor>();
  const listeners = new Set<() => void>();
  const persist = () => {
    if (!config) return;
    const stored: StoredJob[] = jobs.flatMap((job) => {
      const descriptor = descriptors.get(job.id);
      return descriptor
        ? [{ id: job.id, ownerId: job.ownerId, label: job.label, descriptor }]
        : [];
    });
    try {
      if (stored.length) config.storage.setItem(STORAGE_KEY, JSON.stringify(stored));
      else config.storage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("[PublishQueue] Could not save pending posts", error);
    }
  };
  const emit = () => {
    persist();
    listeners.forEach((listener) => listener());
  };
  /** Drop a settled job and the app-storage copies it owned. */
  const forget = (id: string) => {
    const descriptor = descriptors.get(id);
    tasks.delete(id);
    descriptors.delete(id);
    jobs = jobs.filter((job) => job.id !== id);
    if (descriptor && config?.release) {
      try {
        config.release(descriptor);
      } catch (error) {
        console.warn("[PublishQueue] Could not clean up post media", error);
      }
    }
  };
  const update = (id: string, values: Partial<PublishJob>) => {
    jobs = jobs.map((job) => job.id === id ? { ...job, ...values } : job);
    emit();
  };
  async function drain() {
    if (running) return;
    running = true;
    try {
      let next: PublishJob | undefined;
      while ((next = jobs.find((job) => job.status === "queued"))) {
        const id = next.id;
        update(id, { status: "running", message: "Preparing your post…" });
        try {
          await tasks.get(id)!(
            (message) => update(id, { message }),
            (descriptor) => {
              descriptors.set(id, descriptor);
              persist();
            },
          );
          forget(id);
          emit();
        } catch (error) {
          update(id, {
            status: "failed",
            message: error instanceof Error ? error.message : "Your post could not be shared. Try again.",
          });
        }
      }
    } finally {
      running = false;
    }
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => jobs,
    enqueue(ownerId: string, label: string, task: Task, descriptor?: PublishDescriptor) {
      if (jobs.length >= MAX_PENDING) throw new Error("Finish or dismiss a pending post before sharing another.");
      const id = `publish-${Date.now()}-${++sequence}`;
      tasks.set(id, task);
      if (descriptor) descriptors.set(id, descriptor);
      jobs = [...jobs, { id, ownerId, label, status: "queued", message: "Waiting to upload…" }];
      emit();
      void drain();
      return id;
    },
    retry(id: string) {
      if (!jobs.some((job) => job.id === id && job.status === "failed")) return;
      update(id, { status: "queued", message: "Waiting to retry…" });
      void drain();
    },
    dismiss(id: string) {
      if (!jobs.some((job) => job.id === id && job.status === "failed")) return;
      forget(id);
      emit();
    },
    /** Attach storage and the descriptor rebuilder. Call once at startup. */
    configure(next: PublishQueueConfig) {
      config = next;
      // Only flush what is already in memory. An empty queue must not clear
      // storage before restore() has had a chance to read it.
      if (jobs.length) persist();
    },
    /**
     * Rebuild jobs left behind by a killed app. Everything comes back as
     * queued: a job persisted while running died mid-flight, and replaying it
     * is safe because the operation id is part of the descriptor.
     */
    restore() {
      const build = config?.build;
      if (!config || !build) return 0;
      let raw: string | null = null;
      try {
        raw = config.storage.getItem(STORAGE_KEY);
      } catch (error) {
        console.warn("[PublishQueue] Could not read pending posts", error);
      }
      if (!raw) return 0;
      let stored: unknown;
      try {
        stored = JSON.parse(raw);
      } catch {
        config.storage.removeItem(STORAGE_KEY);
        return 0;
      }
      if (!Array.isArray(stored)) {
        config.storage.removeItem(STORAGE_KEY);
        return 0;
      }
      const pending = (stored as StoredJob[])
        .filter((entry) => entry?.id && entry?.ownerId && entry?.descriptor)
        .filter((entry) => !jobs.some((job) => job.id === entry.id))
        .slice(0, Math.max(MAX_PENDING - jobs.length, 0));
      for (const entry of pending) {
        descriptors.set(entry.id, entry.descriptor);
        tasks.set(entry.id, build(entry.descriptor, entry.ownerId));
        jobs = [...jobs, {
          id: entry.id,
          ownerId: entry.ownerId,
          label: entry.label,
          status: "queued",
          message: "Picking up where this post left off…",
          resumed: true,
        }];
      }
      emit();
      void drain();
      return pending.length;
    },
  };
}
export const postPublishQueue = createPublishQueue();
