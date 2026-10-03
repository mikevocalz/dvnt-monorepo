import { parseMemberHandle, resolveRoomMemberTarget } from "./room-member-handle.ts";

function fakeClient(rows: { id: number; room_id: number; user_id: string }[]) {
  return {
    from(_table: string) {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq(col: string, val: unknown) {
          filters[col] = val;
          return q;
        },
        maybeSingle() {
          const row = rows.find((r) => r.id === filters.id && r.room_id === filters.room_id);
          return Promise.resolve({ data: row ? { user_id: row.user_id } : null, error: null });
        },
      };
      return q;
    },
  };
}

Deno.test("parseMemberHandle accepts member:<id> only", () => {
  if (parseMemberHandle("member:41") !== 41) throw new Error("handle not parsed");
  for (const bad of ["ba-41", "member:", "member:0", "member:-1", "member:4x", " member:41", "member:41 "]) {
    if (parseMemberHandle(bad) !== null) throw new Error(`accepted ${bad}`);
  }
});

Deno.test("a handle resolves only inside its own room", async () => {
  const client = fakeClient([{ id: 41, room_id: 7, user_id: "ba-sam" }]);
  if ((await resolveRoomMemberTarget(client, 7, "member:41")) !== "ba-sam") throw new Error("did not resolve");
  if ((await resolveRoomMemberTarget(client, 8, "member:41")) !== null) throw new Error("resolved across rooms");
  if ((await resolveRoomMemberTarget(client, 7, "member:42")) !== null) throw new Error("resolved a missing row");
});

Deno.test("a plain auth id passes through", async () => {
  const client = fakeClient([]);
  if ((await resolveRoomMemberTarget(client, 7, "ba-dana")) !== "ba-dana") throw new Error("auth id changed");
});
