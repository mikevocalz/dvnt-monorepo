import { getAuthIdFromStore } from "./identity";
import { getSessionLifecycle } from "./session-lifecycle";
import { useAuthStore } from "../stores/auth-store";

export interface FollowIdentity {
  viewerId: string;
  authId: string;
  epoch: number;
  revision: number;
}

// Store-only switches need not publish a session boundary. Observe each change,
// including A -> B -> A batched into one render, without retaining credentials.
const storeIdentity = () => {
  const state = useAuthStore.getState();
  return JSON.stringify([state.isAuthenticated, state.user?.id, state.user?.authId]);
};
let owner = storeIdentity();
let revision = 0;
const listeners = new Set<() => void>();
useAuthStore.subscribe(() => {
  const next = storeIdentity();
  if (next === owner) return;
  owner = next;
  revision++;
  for (const listener of listeners) listener();
});
export const getFollowIdentityRevision = () => revision;
export function subscribeFollowIdentityRevision(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Bind an operation to one account AND sign-in, including A -> B -> A. */
export function getFollowIdentity(): FollowIdentity | null {
  const state = useAuthStore.getState();
  const viewerId = state.user?.id;
  const authId = getAuthIdFromStore();
  const session = getSessionLifecycle();
  if (!viewerId || !authId || state.isAuthenticated === false || state.authStatus === "unauthenticated" || !session.ready || (session.authId && session.authId !== authId)) return null;
  return { viewerId, authId, epoch: session.epoch, revision };
}

export function isFollowIdentityCurrent(identity: FollowIdentity | null | undefined): identity is FollowIdentity {
  const current = getFollowIdentity();
  return Boolean(identity && current && identity.viewerId === current.viewerId &&
    identity.authId === current.authId && identity.epoch === current.epoch && identity.revision === current.revision);
}

export function assertFollowIdentity(identity: FollowIdentity | null | undefined): asserts identity is FollowIdentity {
  if (!isFollowIdentityCurrent(identity)) throw new Error("Account changed. Reload before trying again.");
}
