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

// ===========================================================================
// Game Night state contract
// ===========================================================================

export interface GameNightRoom {
  id: number;
  code: string;
  status: "open" | "playing" | "ended";
  is_private: boolean;
  host_id: string;
  created_at: string;
}

export interface GameNightMember {
  user_id: string;
  role: "player" | "watcher";
  seat_no: number | null;
  ready: boolean;
  joined_at: string;
  name: string | null;
  avatar: string | null;
}

export interface GameNightMatch {
  id: number;
  match_no: number;
  mode: "classic" | "duel";
  status: "active" | "completed" | "abandoned";
  target_score: number;
  scores: Record<string, number>;
  winner_user_id: string | null;
  tied: boolean;
  current_round_no: number;
  duel_paired_rounds: number | null;
}

export interface RevealEntry {
  submission_id: number;
  texts: string[];
  user_id?: string;
  name?: string;
  is_winner?: boolean;
}

export interface GameNightRound {
  id: number;
  round_no: number;
  phase:
    | "dealing"
    | "submitting"
    | "judging"
    | "round_results"
    | "duel_lock"
    | "duel_results"
    | "voided";
  judge_user_id: string | null;
  duel_subject_user_id: string | null;
  prompt: { card_id: string; text: string; pick: number } | null;
  deadline_at: string | null;
  submissions_in: number;
  submissions_expected: number;
  reveal: RevealEntry[];
  duel_options?: { card_id: string; text: string }[];
  duel_choices?:
    | { mine?: string; kind?: string }
    | {
        subject?: string;
        prediction?: string;
        subject_user_id?: string;
        predictor_user_id?: string;
      }
    | null;
  my_submission?: { cards: string[] | null; texts: string[] | null } | null;
  winner_user_id?: string | null;
}

export interface GameNightMe {
  user_id: string;
  role: "player" | "watcher" | null;
  member: boolean;
  seat_no: number | null;
  ready: boolean;
  is_host: boolean;
  hand: { card_id: string; text: string }[];
}

export interface GameNightState {
  room: GameNightRoom;
  members: GameNightMember[];
  match: GameNightMatch | null;
  round: GameNightRound | null;
  me: GameNightMe;
  server_time: string;
}

export interface GameNightMessage {
  id: number;
  roomId?: number;
  userId: string;
  kind: "text" | "gif" | "reaction";
  body: string | null;
  gif: {
    id?: string;
    url?: string;
    preview_url?: string;
    width?: number;
    height?: number;
    provider?: string;
  } | null;
  reaction: string | null;
  createdAt: string;
}

export interface LeaderboardEntry {
  user_id: string;
  name: string | null;
  avatar: string | null;
  wins: number;
  matches: number;
  points: number;
  rank: number;
}

export interface Leaderboard {
  mode: string;
  top10: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

const FRIENDLY_ERRORS: Record<string, string> = {
  room_not_found: "That room doesn't exist or already ended.",
  not_host: "Only the host can do that.",
  not_judge: "Only the judge can do that.",
  not_a_player: "Only seated players can do that.",
  not_a_member: "You're not in this room.",
  players_not_ready: "Not everyone is ready yet.",
  need_two_players: "At least two seated players are needed.",
  room_full: "This table is full.",
  room_not_open: "This room isn't open for seating.",
  phase_not_submitting: "This round is not accepting submissions right now.",
  phase_not_judging: "This round is not in judging right now.",
  phase_not_duel_lock: "This round is not ready for a duel pick.",
  judge_cannot_submit: "The judge can't submit cards.",
  not_duel: "This match is not a duel.",
  no_active_match: "No match is active.",
  wrong_card_count: "Wrong number of cards.",
  card_not_in_hand: "You don't have that card.",
  card_not_offered: "That card isn't offered.",
  invalid_submission: "That submission isn't valid.",
  cannot_kick_self: "You can't kick yourself.",
  deck_not_seeded: "The card deck isn't ready. Ask the host to seed cards.",
  room_code_collisions: "Couldn't generate a room code. Try again.",
  bad_kind: "Unsupported message kind.",
  empty_body: "Message can't be empty.",
  empty_gif: "No GIF selected.",
  rate_limited: "Slow down — you've sent too many messages.",
};

export function mapGameNightRpcError(
  error: { message?: string; code?: string } | string | null | undefined,
): string {
  const raw =
    typeof error === "string" ? error : error?.message ?? "unknown_error";
  return (
    FRIENDLY_ERRORS[raw] ?? `Game Night error (${raw}). Please try again.`
  );
}

function unwrapFirstRow<T>(data: unknown): T {
  const rows = (data ?? []) as unknown[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No response from the server.");
  }
  return rows[0] as T;
}

// ===========================================================================
// Room lifecycle
// ===========================================================================

export async function createRoom(
  idempotencyKey?: string,
  isPrivate = true,
): Promise<{ roomId: number; roomCode: string; created: boolean }> {
  const { data, error } = await supabase.rpc("game_night_create_room", {
    p_idempotency_key: idempotencyKey ?? null,
    p_private: isPrivate,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  const row = unwrapFirstRow<{
    room_id: number;
    room_code: string;
    created: boolean;
  }>(data);
  return {
    roomId: row.room_id,
    roomCode: row.room_code,
    created: row.created,
  };
}

export async function joinRoom(code: string): Promise<{
  roomId: number;
  roomCode: string;
  role: "player" | "watcher";
  seatNo: number | null;
}> {
  const { data, error } = await supabase.rpc("game_night_join_room", {
    p_code: code,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  const row = unwrapFirstRow<{
    room_id: number;
    room_code: string;
    role: string;
    seat_no: number | null;
  }>(data);
  return {
    roomId: row.room_id,
    roomCode: row.room_code,
    role: row.role === "player" ? "player" : "watcher",
    seatNo: row.seat_no,
  };
}

export async function resolveRoom(code: string): Promise<{
  roomId: number;
  roomCode: string;
  status: "open" | "playing";
  hostName: string | null;
  playerCount: number;
  watcherCount: number;
  myRole: "player" | "watcher" | null;
}> {
  const { data, error } = await supabase.rpc("game_night_resolve_room", {
    p_code: code,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  const rows = (data ?? []) as unknown[];
  if (rows.length === 0) {
    throw new Error(mapGameNightRpcError("room_not_found"));
  }
  const row = rows[0] as {
    room_id: number;
    room_code: string;
    status: string;
    host_name: string | null;
    player_count: number;
    watcher_count: number;
    my_role: string | null;
  };
  return {
    roomId: row.room_id,
    roomCode: row.room_code,
    status: row.status === "open" ? "open" : "playing",
    hostName: row.host_name,
    playerCount: row.player_count,
    watcherCount: row.watcher_count,
    myRole:
      row.my_role === "player" || row.my_role === "watcher"
        ? row.my_role
        : null,
  };
}

export async function leaveRoom(code: string): Promise<void> {
  const { error } = await supabase.rpc("game_night_leave_room", { p_code: code });
  if (error) throw new Error(mapGameNightRpcError(error));
}

export async function setReady(code: string, ready: boolean): Promise<void> {
  const { error } = await supabase.rpc("game_night_set_ready", {
    p_code: code,
    p_ready: ready,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
}

export async function takeSeat(code: string): Promise<{
  role: "player" | "watcher";
  seatNo: number | null;
}> {
  const { data, error } = await supabase.rpc("game_night_take_seat", {
    p_code: code,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  const row = unwrapFirstRow<{ role: string; seat_no: number | null }>(data);
  return {
    role: row.role === "player" ? "player" : "watcher",
    seatNo: row.seat_no,
  };
}

export async function kickMember(
  code: string,
  userId: string,
): Promise<void> {
  const { error } = await supabase.rpc("game_night_kick", {
    p_code: code,
    p_user_id: userId,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
}

export async function ping(code: string): Promise<void> {
  const { error } = await supabase.rpc("game_night_ping", { p_code: code });
  if (error) throw new Error(mapGameNightRpcError(error));
}

// ===========================================================================
// Match commands
// ===========================================================================

export async function startMatch(code: string, commandId?: string): Promise<number> {
  const { data, error } = await supabase.rpc("game_night_start_match", {
    p_code: code,
    p_command_id: commandId ?? null,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  return Number(data ?? 0);
}

export async function submitCards(
  code: string,
  cardIds: string[],
  commandId?: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("game_night_submit", {
    p_code: code,
    p_card_ids: cardIds,
    p_command_id: commandId ?? null,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  return Number(data ?? 0);
}

export async function judgePick(
  code: string,
  submissionId: number,
  commandId?: string,
): Promise<void> {
  const { error } = await supabase.rpc("game_night_judge_pick", {
    p_code: code,
    p_submission_id: submissionId,
    p_command_id: commandId ?? null,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
}

export async function duelPick(
  code: string,
  cardId: string,
  commandId?: string,
): Promise<void> {
  const { error } = await supabase.rpc("game_night_duel_pick", {
    p_code: code,
    p_card_id: cardId,
    p_command_id: commandId ?? null,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
}

export async function endRoom(code: string): Promise<void> {
  const { error } = await supabase.rpc("game_night_end_room", { p_code: code });
  if (error) throw new Error(mapGameNightRpcError(error));
}

// ===========================================================================
// State, chat and leaderboard
// ===========================================================================

export async function fetchState(code: string): Promise<GameNightState> {
  const { data, error } = await supabase.rpc("game_night_state", {
    p_code: code,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  const payload = data as { error?: string } | GameNightState | null;
  if (!payload) throw new Error("No response from the server.");
  if (typeof payload === "object" && "error" in payload) {
    throw new Error(mapGameNightRpcError(payload.error));
  }
  return payload as GameNightState;
}

export async function sendRoomMessage(
  code: string,
  kind: "text" | "gif" | "reaction",
  opts: { body?: string; gif?: unknown; reaction?: string },
): Promise<number> {
  const { data, error } = await supabase.rpc("game_night_send_message", {
    p_code: code,
    p_kind: kind,
    p_body: opts.body ?? null,
    p_gif: opts.gif ?? null,
    p_reaction: opts.reaction ?? null,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  return Number(data ?? 0);
}

export async function fetchLeaderboard(
  mode = "classic",
): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc("game_night_leaderboard", {
    p_mode: mode,
  });
  if (error) throw new Error(mapGameNightRpcError(error));
  const payload = (data ?? {}) as Partial<Leaderboard>;
  return {
    mode: payload.mode ?? mode,
    top10: Array.isArray(payload.top10) ? payload.top10 : [],
    me: payload.me ?? null,
  };
}

export async function fetchRoomMessages(
  roomId: number,
  beforeId?: number,
): Promise<GameNightMessage[]> {
  let query = supabase
    .from("game_night_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("id", { ascending: false })
    .limit(50);
  if (beforeId !== undefined) {
    query = query.lt("id", beforeId);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    userId: row.user_id,
    kind: row.kind,
    body: row.body ?? null,
    gif: row.gif ?? null,
    reaction: row.reaction ?? null,
    createdAt: row.created_at,
  }));
}
