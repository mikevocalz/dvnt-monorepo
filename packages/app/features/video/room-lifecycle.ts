/**
 * A room end is terminal for one admitted room/user lifetime. The media relay
 * is not the source of truth: MoQ sessions may survive the legacy Fishjam room
 * deletion, and membership-filtered events may disappear when members leave.
 */
export interface RoomLifecycleSnapshot {
  status: "open" | "closed" | "ended";
  endedAt?: string | null;
}

export interface RoomLifecycleSource {
  load: (signal: AbortSignal) => Promise<RoomLifecycleSnapshot | null>;
  subscribe: (callbacks: {
    onSnapshot: (snapshot: RoomLifecycleSnapshot) => void;
    onReconnect: () => void;
  }) => () => void;
  subscribeResume?: (check: () => void) => () => void;
}

export const ROOM_LIFECYCLE_POLL_MS = 5_000;
export const ROOM_LIFECYCLE_READ_TIMEOUT_MS = 8_000;

type Schedule = (callback: () => void, delayMs: number) => () => void;
const scheduleTimeout: Schedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/** Side-effect-free until explicitly enabled by a successful server admission. */
export function createRoomLifecycleWatcher(options: {
  roomId?: string | null;
  userId?: string | null;
  enabled: boolean;
  source: RoomLifecycleSource;
  onEnded: () => void;
  onError?: (error: unknown) => void;
  pollMs?: number;
  readTimeoutMs?: number;
  schedule?: Schedule;
}) {
  let stopped = !options.enabled || !options.roomId || !options.userId;
  let ended = false;
  let reading = false;
  let dirty = false;
  let abortRead: (() => void) | undefined;
  let cancelPoll: (() => void) | undefined;
  const cleanup = new Set<() => void>();
  const schedule = options.schedule ?? scheduleTimeout;

  function addCleanup(dispose: () => void) {
    // Some adapters can synchronously report an already-ended room while
    // subscribing. Do not leak the subscription returned after that callback.
    if (stopped) dispose();
    else cleanup.add(dispose);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    dirty = false;
    cancelPoll?.();
    cancelPoll = undefined;
    abortRead?.();
    abortRead = undefined;
    const disposers = [...cleanup];
    cleanup.clear();
    for (const dispose of disposers) {
      try { dispose(); }
      catch (error) { options.onError?.(error); }
    }
  }

  function notifyEnded() {
    if (stopped || ended) return;
    ended = true;
    // Tear down observers BEFORE notifying the screen: callbacks can synchronously
    // unmount, and both the event stream and room row can report the same end.
    stop();
    options.onEnded();
  }

  function observe(snapshot: RoomLifecycleSnapshot | null) {
    if (stopped) return;
    if (snapshot?.status === "ended" || snapshot?.status === "closed") notifyEnded();
    // A missing/hidden row or transport error is not proof of an end. Preserve
    // the current state and retry rather than inventing a successful snapshot.
  }

  async function drain() {
    if (stopped || reading) return;
    reading = true;
    try {
      while (dirty && !stopped) {
        dirty = false;
        const controller = new AbortController();
        let rejectRead!: (reason: Error) => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          rejectRead = reject;
        });
        const cancelTimeout = schedule(() => {
          controller.abort();
          rejectRead(new Error("Room lifecycle read timed out"));
        }, options.readTimeoutMs ?? ROOM_LIFECYCLE_READ_TIMEOUT_MS);
        abortRead = () => {
          cancelTimeout();
          controller.abort();
          rejectRead(new Error("Room lifecycle watcher stopped"));
        };
        try {
          const snapshot = await Promise.race([
            options.source.load(controller.signal),
            cancelled,
          ]);
          observe(snapshot);
        } catch (error) {
          if (!stopped) options.onError?.(error);
        } finally {
          cancelTimeout();
          abortRead = undefined;
        }
      }
    } finally {
      reading = false;
    }
  }

  function checkNow() {
    if (stopped) return;
    // If an old read is in flight during reconnect, perform a fresh read after
    // it. Do not trust an "open" snapshot obtained before the missed room end.
    dirty = true;
    void drain();
  }

  function poll() {
    if (stopped) return;
    cancelPoll = schedule(() => {
      cancelPoll = undefined;
      checkNow();
      poll();
    }, options.pollMs ?? ROOM_LIFECYCLE_POLL_MS);
  }

  if (!stopped) {
    try {
      addCleanup(options.source.subscribe({
        onSnapshot: observe,
        onReconnect: checkNow,
      }));
    } catch (error) {
      options.onError?.(error);
      // A broken realtime channel must not disable authoritative polling.
    }
    if (!stopped && options.source.subscribeResume) {
      try { addCleanup(options.source.subscribeResume(checkNow)); }
      catch (error) { options.onError?.(error); }
    }
    checkNow();
    poll();
  }

  return { checkNow, notifyEnded, stop, isEnded: () => ended };
}
