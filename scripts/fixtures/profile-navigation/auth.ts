import { useSyncExternalStore } from 'react';

type User = { authId: string; id: string; username: string; avatar?: string; postsCount?: number; name?: string };
type Snapshot = { user: User | null; _hasHydrated: boolean; isAuthenticated: boolean };
const listeners = new Set<(next: Snapshot, previous: Snapshot) => void>();
const initial: Snapshot = {
  user: { authId: 'fixture-member-a', id: 'fixture-a', username: 'fixture_member', avatar: 'fictional-avatar', postsCount: 1 },
  _hasHydrated: true,
  isAuthenticated: true,
};
let snapshot = initial;
export function replaceAuth(patch: Partial<Snapshot>) {
  const previous = snapshot;
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener(snapshot, previous);
}
function subscribe(listener: (next: Snapshot, previous: Snapshot) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const useAuthStore = Object.assign(
  function useAuthStore<T>(select: (state: Snapshot) => T): T {
    return select(useSyncExternalStore(subscribe, () => snapshot, () => initial));
  },
  { getState: () => snapshot, subscribe },
);
