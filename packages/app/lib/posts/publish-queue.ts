/** Foreground publishing survives composer navigation, not app termination. */
export interface PublishJob {
  id: string;
  ownerId: string;
  label: string;
  status: "queued" | "running" | "failed";
  message: string;
}
type Task = (report: (message: string) => void) => Promise<void>;

export function createPublishQueue() {
  let jobs: PublishJob[] = [];
  let running = false;
  let sequence = 0;
  const tasks = new Map<string, Task>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
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
          await tasks.get(id)!((message) => update(id, { message }));
          tasks.delete(id);
          jobs = jobs.filter((job) => job.id !== id);
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
    enqueue(ownerId: string, label: string, task: Task) {
      if (jobs.length >= 5) throw new Error("Finish or dismiss a pending post before sharing another.");
      const id = `publish-${Date.now()}-${++sequence}`;
      tasks.set(id, task);
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
      tasks.delete(id);
      jobs = jobs.filter((job) => job.id !== id);
      emit();
    },
  };
}
export const postPublishQueue = createPublishQueue();
