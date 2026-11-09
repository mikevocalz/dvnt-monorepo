import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

/** Bind current-session APIs to the viewer in their cache key, including prefetches. */
export async function readViewerScoped<T>(
  viewerId: string | undefined,
  read: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let obsolete = false;
  const assertCurrent = () => {
    if (!viewerId || obsolete || signal?.aborted || useAuthStore.getState().user?.id !== viewerId) {
      throw new Error("Query belongs to an inactive account");
    }
  };
  assertCurrent();
  // Current-id comparisons alone miss A→B→A while a request is pending.
  const unsubscribe = useAuthStore.subscribe((state) => {
    if (state.user?.id !== viewerId) obsolete = true;
  });
  try {
    const result = await read();
    assertCurrent();
    return result;
  } finally {
    unsubscribe();
  }
}
