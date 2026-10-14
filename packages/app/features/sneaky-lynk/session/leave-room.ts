/** Hosts stay in the room when ending fails; guests can always stop locally. */
export async function leaveRoomSafely(options: {
  isHost: boolean;
  endRoom: () => Promise<{ ok: boolean; error?: { message?: string } }>;
  leaveRoom: () => Promise<unknown>;
  exit: () => void;
  onFailure: (message: string) => void;
  /** The originating room/account is still mounted and owns this action. */
  isCurrent?: () => boolean;
}): Promise<boolean> {
  const isCurrent = () => options.isCurrent?.() !== false;
  if (!isCurrent()) return false;
  if (options.isHost) {
    try {
      const result = await options.endRoom();
      if (!isCurrent()) return false;
      if (!result.ok && !/no longer open|already ended|has ended|room not found|not found/i.test(result.error?.message ?? "")) {
        options.onFailure(result.error?.message || "Try again. The Lynk is still open.");
        return false;
      }
    } catch {
      if (!isCurrent()) return false;
      options.onFailure("Couldn't confirm the room ended. Please try again.");
      return false;
    }
  } else {
    // Navigation and releasing devices must not wait for a guest's network.
    void options.leaveRoom().catch(() => {});
  }
  if (!isCurrent()) return false;
  options.exit();
  return true;
}
