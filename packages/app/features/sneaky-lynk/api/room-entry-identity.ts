import { supabase, getBridgeRequestEpoch } from "@dvnt/app/lib/supabase/client";
import { getCurrentUserAuthId } from "@dvnt/app/lib/api/auth-helper";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export type RoomEntryIdentity =
  | { kind: "choice" }
  | { kind: "active"; anonymous: boolean; anonLabel: string | null };

/**
 * An active membership keeps its identity on reconnect, including a freshly
 * accepted co-host. Read ONLY self through the privacy-safe roster RPC. Direct
 * table user_id access is deliberately forbidden; never fall back to that or
 * fetch another member's identity to infer the caller's state.
 * This is presentation, not admission. The normal join remains authoritative.
 */
export async function getRoomEntryIdentity(
  roomId: string,
  options?: { isCurrent?: () => boolean },
): Promise<RoomEntryIdentity> {
  const epoch = getBridgeRequestEpoch();
  const owner = () => {
    const state = useAuthStore.getState();
    return state.user ? `${state.user.id}:${state.user.authId ?? ""}` : "";
  };
  const account = owner();
  const assertCurrent = () => {
    if (owner() !== account || getBridgeRequestEpoch() !== epoch || options?.isCurrent?.() === false)
      throw new Error("Your room entry changed. Try again.");
  };
  assertCurrent();
  // Signed-out visitors have no existing membership. Account-gated entry will
  // run this read again under the newly authenticated account before consent.
  if (!account) return { kind: "choice" };
  const authId = await getCurrentUserAuthId();
  assertCurrent();
  if (!authId) throw new Error("Couldn't verify your room identity. Try again.");

  const numeric = /^[1-9]\d*$/.test(roomId);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId);
  if (!numeric && !uuid) throw new Error("This room is unavailable.");
  let internalRoomId = numeric ? Number(roomId) : null;
  if (uuid) {
    const { data, error } = await supabase.from("video_rooms").select("id")
      .eq("uuid", roomId).setHeader("x-dvnt-bridge-epoch", epoch).maybeSingle();
    assertCurrent();
    if (error) throw new Error("Couldn't verify your room identity. Try again.");
    // The parallel room lookup owns the unavailable-room surface.
    if (!data) return { kind: "choice" };
    internalRoomId = Number(data.id);
  }
  if (!Number.isSafeInteger(internalRoomId) || internalRoomId! <= 0)
    throw new Error("This room is unavailable.");

  const { data, error } = await supabase.rpc("lynk_room_roster", { p_room_id: internalRoomId })
    .select("status,is_anonymous,anon_label")
    .eq("user_id", authId)
    .setHeader("x-dvnt-bridge-epoch", epoch)
    .maybeSingle();
  assertCurrent();
  if (error) throw new Error("Couldn't verify your room identity. Try again.");
  if (!data || data.status !== "active") return { kind: "choice" };
  if (typeof data.is_anonymous !== "boolean")
    throw new Error("Couldn't verify your room identity. Try again.");
  return {
    kind: "active",
    anonymous: data.is_anonymous,
    anonLabel: data.is_anonymous && typeof data.anon_label === "string" ? data.anon_label : null,
  };
}
