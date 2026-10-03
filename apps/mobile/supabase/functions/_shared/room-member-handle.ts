/**
 * Opaque handles for anonymous Sneaky Lynk members.
 *
 * Clients cannot read video_room_members.user_id (migration
 * 20261003150200_video_room_members_user_id_private.sql). The roster RPC
 * public.lynk_room_roster hands every viewer `member:<row id>` in place of the
 * auth id of an anonymous member who is not the viewer. Moderation endpoints
 * take that handle as `targetUserId` and resolve it here, with service_role,
 * so a host can still kick, ban, mute or promote an anonymous member without
 * the client ever learning who they are.
 *
 * A plain auth id passes through unchanged after the same membership check.
 */

const HANDLE = /^member:(\d{1,10})$/;

/** Row id from a `member:<id>` handle, or null when `target` is not a handle. */
export function parseMemberHandle(target: string): number | null {
  const m = HANDLE.exec(target);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// deno-lint-ignore no-explicit-any
type ServiceClient = any;

/**
 * Real auth id for `target` in `internalRoomId`, or null when the handle does
 * not name a member row of that room. A handle from another room never
 * resolves, so a client cannot walk row ids across rooms.
 */
export async function resolveRoomMemberTarget(
  supabase: ServiceClient,
  internalRoomId: number,
  target: string,
): Promise<string | null> {
  const rowId = parseMemberHandle(target);
  if (rowId === null) return target;
  const { data, error } = await supabase
    .from("video_room_members")
    .select("user_id")
    .eq("id", rowId)
    .eq("room_id", internalRoomId)
    .maybeSingle();
  if (error || !data?.user_id) return null;
  return String(data.user_id);
}
