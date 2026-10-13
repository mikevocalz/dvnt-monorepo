import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { RoomLifecycleSource } from "./room-lifecycle";

const ROOM_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Persisted room status stays authoritative after active membership is removed. */
export function createRoomLifecycleSource(options: {
  roomId: string;
  userId: string;
  client: SupabaseClient;
  createChannel: (prefix: string) => RealtimeChannel;
}): RoomLifecycleSource {
  const { roomId, userId, client, createChannel } = options;
  const field = ROOM_UUID.test(roomId) ? "uuid" : "id";
  return {
    async load(signal) {
      const { data, error } = await client
        .from("video_rooms")
        .select("status, ended_at")
        .eq(field, roomId)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      if (data.status !== "open" && data.status !== "closed" && data.status !== "ended") {
        throw new Error("Invalid room lifecycle status");
      }
      return { status: data.status, endedAt: data.ended_at };
    },
    subscribe({ onSnapshot, onReconnect }) {
      const channel = createChannel(`video_room_lifecycle:${roomId}:${userId}`)
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "video_rooms",
          filter: `${field}=eq.${roomId}`,
        }, (payload) => {
          const row = payload.new as { status?: string; ended_at?: string | null };
          if (row.status === "open" || row.status === "closed" || row.status === "ended") {
            onSnapshot({ status: row.status, endedAt: row.ended_at });
          }
        })
        .subscribe((status) => {
          // Supabase emits SUBSCRIBED after every successful reconnect.
          if (status === "SUBSCRIBED") onReconnect();
        });
      return () => { void client.removeChannel(channel); };
    },
  };
}
