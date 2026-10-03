import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";

export type EventMediaUploadState = "queued" | "uploading" | "uploaded" | "failed";

export interface EventMediaUploadJob {
  localUri: string;
  remoteUrl?: string;
  slot: "flyer" | "poster" | "gallery";
  mediaType: "image" | "video";
  state: EventMediaUploadState;
  attempts: number;
  progress: number;
  error?: string;
  updatedAt: number;
}

interface Store {
  jobs: Record<string, EventMediaUploadJob>;
  queue: (job: Omit<EventMediaUploadJob, "state"|"attempts"|"progress"|"updatedAt">) => void;
  patch: (localUri: string, values: Partial<EventMediaUploadJob>) => void;
  retry: (localUri: string) => void;
  remove: (localUri: string) => void;
  clearUploaded: () => void;
}

export const useEventMediaPreuploadStore = create<Store>()(
  persist(
    (set) => ({
      jobs: {},
      queue: (job) => set((s) => ({
        jobs: {
          ...s.jobs,
          [job.localUri]: s.jobs[job.localUri] ?? {
            ...job,
            state: "queued",
            attempts: 0,
            progress: 0,
            updatedAt: Date.now(),
          },
        },
      })),
      patch: (localUri, values) => set((s) => {
        const current = s.jobs[localUri];
        if (!current) return s;
        return {
          jobs: {
            ...s.jobs,
            [localUri]: { ...current, ...values, updatedAt: Date.now() },
          },
        };
      }),
      retry: (localUri) => set((s) => {
        const current = s.jobs[localUri];
        if (!current) return s;
        return {
          jobs: {
            ...s.jobs,
            [localUri]: {
              ...current,
              state: "queued",
              error: undefined,
              progress: 0,
              updatedAt: Date.now(),
            },
          },
        };
      }),
      remove: (localUri) => set((s) => {
        const jobs = { ...s.jobs };
        delete jobs[localUri];
        return { jobs };
      }),
      clearUploaded: () => set((s) => ({
        jobs: Object.fromEntries(
          Object.entries(s.jobs).filter(([, job]) => job.state !== "uploaded"),
        ),
      })),
    }),
    {
      name: "event-media-preupload-v1",
      storage: mmkvStorage,
      // Never persist a transient "uploading" state across process death.
      merge: (persisted, current) => {
        const incoming = (persisted as Partial<Store>)?.jobs ?? {};
        const jobs = Object.fromEntries(
          Object.entries(incoming).map(([key, job]) => [
            key,
            job.state === "uploading"
              ? { ...job, state: "queued" as const, progress: 0 }
              : job,
          ]),
        );
        return { ...current, ...(persisted as Partial<Store>), jobs };
      },
    },
  ),
);
