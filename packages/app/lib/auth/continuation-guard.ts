import { useAuthStore } from "../stores/auth-store";
import { getSessionLifecycle } from "./session-lifecycle";

/** Async navigation belongs to the account/session that started it. Observe
 * every identity transition, including A -> B -> A within one React batch. */
export function captureAuthContinuation({ includeSession = true } = {}) {
  const identity = () => {
    const state = useAuthStore.getState();
    return JSON.stringify([state.isAuthenticated, state.user?.id, state.user?.authId]);
  };
  const owner = identity();
  const epoch = getSessionLifecycle().epoch;
  let changed = false;
  const unsubscribe = useAuthStore.subscribe(() => { if (identity() !== owner) changed = true; });
  return {
    isCurrent: () => !changed && identity() === owner && (!includeSession || getSessionLifecycle().epoch === epoch),
    release: unsubscribe,
  };
}
