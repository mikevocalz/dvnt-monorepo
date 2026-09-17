"use client";

/**
 * Reading the live-rooms list.
 *
 * Reads are client-direct through the bridged JWT, which is this repo's split:
 * writes go through an edge function on the service role, reads come straight
 * from PostgREST. See apps/mobile/supabase/migrations/20260917210000.
 *
 * It calls an RPC rather than selecting the tables, because the lobby list is a
 * PROJECTION for people who are not in the room: code, host, counts, status —
 * and deliberately not the roster's user ids. `game_night_rooms_select` only
 * admits members, which is correct for the room screen and useless for a browse
 * list, so widening that policy would have leaked membership to everyone.
 */

import { supabase } from "@dvnt/app/lib/supabase/client";

export interface WatchableRoom {
  roomCode: string;
  status: "open" | "playing";
  hostName: string | null;
  hostAvatar: string | null;
  /** Seated players, 0-4. */
  playerCount: number;
  /** Everyone past the fourth seat. */
  watcherCount: number;
  startedAt: string;
  /** Avatars for the seats, host first. Never includes ids. */
  seatAvatars: { id: string; name: string | null; avatar: string | null }[];
}

interface RpcRow {
  room_code: string;
  status: "open" | "playing";
  host_name: string | null;
  host_avatar: string | null;
  player_count: number;
  watcher_count: number;
  started_at: string;
  seat_avatars: { id: string; name: string | null; avatar: string | null }[] | null;
}

export async function listWatchableRooms(): Promise<WatchableRoom[]> {
  const { data, error } = await supabase.rpc("game_night_list_rooms");
  if (error) throw error;
  return ((data ?? []) as RpcRow[]).map((r) => ({
    roomCode: r.room_code,
    status: r.status,
    hostName: r.host_name,
    hostAvatar: r.host_avatar,
    playerCount: r.player_count ?? 0,
    watcherCount: r.watcher_count ?? 0,
    startedAt: r.started_at,
    seatAvatars: r.seat_avatars ?? [],
  }));
}
