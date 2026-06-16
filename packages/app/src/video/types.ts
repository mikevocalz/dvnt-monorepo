/**
 * Video Chat Type Definitions
 */

export type RoomStatus = "open" | "ended";
export type MemberRole = "host" | "co-host" | "moderator" | "participant";
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
  videoTrack?: any;
  audioTrack?: any;
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
