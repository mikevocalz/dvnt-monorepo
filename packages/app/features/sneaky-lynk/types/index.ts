/**
 * Sneaky Lynk Types
 * Audio-first live rooms with optional video stage
 */

export type RoomStatus = "open" | "ended";
export type MemberRole =
  | "host"
  | "co-host"
  | "moderator"
  | "speaker"
  | "listener";
export type MemberStatus = "active" | "left" | "kicked" | "banned";
export type ConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "poor_network";

export interface SneakyUser {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  isVerified: boolean;
  isAnonymous?: boolean;
  anonLabel?: string | null;
}

export interface SneakyRoom {
  id: string;
  createdBy: string;
  /** Server session deadline, ISO. A room can be `status: "open"` and still
   *  refuse every join with `session_expired`, so "is it joinable" needs this
   *  as well as the status. `null` = unlimited (paid tiers). */
  endsAt?: string | null;
  title: string;
  topic: string;
  description: string;
  sweetSpicyMode?: "sweet" | "spicy";
  isLive: boolean;
  hasVideo: boolean;
  isPublic: boolean;
  status: RoomStatus;
  createdAt: string;
  endedAt?: string;
  host: SneakyUser;
  speakers: SneakyUser[];
  listeners: number;
  maxParticipants?: number;
  fishjamRoomId?: string;
}

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string;
  user: SneakyUser;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  leftAt?: string;
  isSpeaking: boolean;
  hasVideo: boolean;
  isMuted: boolean;
}

export interface RoomEvent {
  id: string;
  roomId: string;
  type:
    | "member_joined"
    | "member_left"
    | "eject"
    | "room_ended"
    | "role_changed"
    | "hand_raised"
    | "hand_lowered";
  actorId: string;
  targetId?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface JoinRoomResponse {
  room: {
    id: string;
    title: string;
    topic: string;
    description: string;
    sweetSpicyMode?: "sweet" | "spicy";
    hasVideo: boolean;
    /** App-only room — web clients are refused a peer token by
     *  `video_join_room`. Absent on backends predating that gate. */
    appOnly?: boolean;
    /** Server-side session deadline, ISO. `null` = unlimited (paid tiers).
     *  Absent on backends predating the gate, which is why the client keeps a
     *  fallback — see RoomTimer's call sites. The client DISPLAYS this; it
     *  does not decide it. */
    endsAt?: string | null;
    fishjamRoomId: string;
  };
  token: string;
  peer: {
    id: string;
    role: MemberRole;
  };
  user: SneakyUser & { isAnonymous: boolean; anonLabel: string | null };
  expiresAt: string;
}

export interface CreateRoomParams {
  title: string;
  topic: string;
  description?: string;
  hasVideo?: boolean;
  isPublic?: boolean;
  invitedUserIds?: string[];
  /**
   * App-only room — web viewers can't join. The only ENFORCED tier of capture
   * protection: `video_join_room` refuses to mint a peer token for a browser,
   * so native clients keep their OS-level guarantees (Android FLAG_SECURE,
   * iOS capture blackout) with no web rail to route around them.
   */
  appOnly?: boolean;
}

export interface EjectPayload {
  action: "kick" | "ban";
  reason?: string;
}

// Mock data types for initial development
export interface MockSpace {
  id: string;
  title: string;
  topic: string;
  description: string;
  isLive: boolean;
  hasVideo: boolean;
  listeners: number;
  host: SneakyUser;
  speakers: SneakyUser[];
}
