/**
 * Video Chat Type Definitions
 */

export type RoomStatus = "open" | "ended";
/**
 * Mirrors the DB check constraint (20260317_video_host_controls.sql):
 * host | co-host | moderator | speaker | participant. `speaker` was missing
 * here while both the DB and `lynk-moq-token`'s PUBLISH_ROLES used it, so a
 * speaker typed as a non-publisher on the client.
 */
export type MemberRole =
  | "host"
  | "co-host"
  | "moderator"
  | "speaker"
  | "participant";
export type MemberStatus = "active" | "left" | "kicked" | "banned";
export type EventType =
  | "room_created"
  | "room_ended"
  | "member_joined"
  | "member_left"
  | "member_kicked"
  | "member_banned"
  | "role_changed"
  | "token_issued"
  | "token_revoked"
  | "eject"
  | "mute_peer"
  | "mute_all"
  | "unmute_all"
  | "unmute_peer"
  | "hand_raised"
  | "hand_lowered";

export interface VideoRoom {
  id: string;
  title: string;
  sweetSpicyMode?: "sweet" | "spicy";
  isPublic: boolean;
  status: RoomStatus;
  maxParticipants: number;
  fishjamRoomId?: string;
  createdBy: string;
  createdAt: string;
  endedAt?: string;
}

export interface RoomMember {
  roomId: string;
  userId: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  leftAt?: string;
  // Populated from users table
  username?: string;
  displayName?: string;
  avatar?: string;
  isAnonymous?: boolean;
  anonLabel?: string | null;
  handRaised?: boolean;
}

export interface RoomEvent {
  id: string;
  roomId: string;
  type: EventType;
  actorId?: string;
  targetId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface EjectPayload {
  action: "kick" | "ban";
  reason?: string;
  expiresAt?: string;
}

export interface JoinRoomResponse {
  room: {
    id: string;
    title: string;
    sweetSpicyMode?: "sweet" | "spicy";
    /** Server session deadline (video_rooms.ends_at). `undefined` = backend
     *  predates the gate, `null` = unlimited, ISO = limited. The client timer
     *  displays this; video_join_room is what actually enforces it. */
    endsAt?: string | null;
    fishjamRoomId: string;
  };
  token: string;
  peer: {
    id: string;
    role: MemberRole;
  };
  user: {
    id: string;
    username?: string;
    displayName?: string;
    avatar?: string;
    isAnonymous?: boolean;
    anonLabel?: string | null;
  };
  expiresAt: string;
}

export interface CreateRoomResponse {
  room: VideoRoom;
}

export interface RefreshTokenResponse {
  token: string;
  peer: {
    id: string;
    role: MemberRole;
  };
  expiresAt: string;
}

export interface Participant {
  odId: string;
  oderId: string;
  userId: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  role: MemberRole;
  isLocal: boolean;
  isCameraOn: boolean;
  isMicOn: boolean;
  isScreenSharing: boolean;
  /** Fishjam track objects — the web room's `RTCView`/`<video>` source. */
  videoTrack?: any;
  audioTrack?: any;
  /**
   * MoQ `BroadcastInfo` for this participant when they are on air (native).
   * `unknown` keeps `react-native-moq` out of the web type graph; the native
   * tile is the only thing that narrows it.
   */
  broadcast?: unknown;
  isAnonymous?: boolean;
  anonLabel?: string | null;
  isHandRaised?: boolean;
  isFrontCamera?: boolean;
}

export interface ConnectionState {
  status:
    | "disconnected"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "error";
  error?: string;
}

export interface VideoRoomState {
  room: VideoRoom | null;
  localUser: {
    id: string;
    username?: string;
    displayName?: string;
    avatar?: string;
    role: MemberRole;
    peerId?: string;
    isAnonymous?: boolean;
    anonLabel?: string | null;
  } | null;
  participants: Participant[];
  connectionState: ConnectionState;
  isCameraOn: boolean;
  isMicOn: boolean;
  isFrontCamera: boolean;
  isEjected: boolean;
  ejectReason?: EjectPayload;
}
