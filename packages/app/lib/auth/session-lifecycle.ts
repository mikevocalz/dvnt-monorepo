/** In-memory authentication boundaries; never contains tokens or persisted completion. */
export type SessionLifecycle = { epoch: number; ready: boolean; authId?: string };
let current: SessionLifecycle = { epoch: 0, ready: true };
const listeners = new Set<() => void>();
export function publishSessionBoundary(state: Omit<SessionLifecycle, "epoch">) {
  current = { ...state, epoch: current.epoch + 1 };
  for (const listener of listeners) listener();
}
export const getSessionLifecycle = () => current;
export function subscribeSessionLifecycle(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
