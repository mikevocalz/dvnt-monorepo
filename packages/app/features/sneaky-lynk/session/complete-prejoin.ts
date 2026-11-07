import { useRoomUIStore } from "../stores/room-ui-store";

/** Commit only the still-current, still-unjoined entry after verification.
 * Repeated or deferred callbacks must not stop a newer preview or join twice. */
export function completePreJoin({ anonymous, isCurrent, prepareJoin }: {
  anonymous: boolean;
  isCurrent: () => boolean;
  prepareJoin: () => void;
}): boolean {
  if (!isCurrent() || useRoomUIStore.getState().phase !== "prejoin") return false;
  prepareJoin();
  const state = useRoomUIStore.getState();
  state.setJoinAnonymous(anonymous);
  state.setPhase("joining");
  return true;
}
