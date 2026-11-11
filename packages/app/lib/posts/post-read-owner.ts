import type { QueryClient } from "@tanstack/react-query";
import { useAppStore } from "@dvnt/app/lib/stores/app-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { capturePostAccessGeneration } from "./post-access-generation";

// Observe transient A -> B -> A changes, even when React batches them into one
// render. No tokens or private content are retained by this counter.
let accountRevision = 0;
useAuthStore.subscribe((current, previous) => {
  if (current.user?.id !== previous.user?.id ||
      current.user?.authId !== previous.user?.authId ||
      current.isAuthenticated !== previous.isAuthenticated ||
      current.authStatus !== previous.authStatus) accountRevision++;
});

let modeRevision = 0;
useAppStore.subscribe((current, previous) => {
  if (current.nsfwEnabled !== previous.nsfwEnabled) modeRevision++;
});

/** Capture before starting a read; validate immediately before every cache write. */
export function capturePostReadOwner(client: QueryClient): () => boolean {
  const accessIsCurrent = capturePostAccessGeneration(client);
  const account = accountRevision;
  const mode = modeRevision;
  const session = getSessionLifecycle().epoch;
  return () => accessIsCurrent() && account === accountRevision && mode === modeRevision &&
    session === getSessionLifecycle().epoch;
}
