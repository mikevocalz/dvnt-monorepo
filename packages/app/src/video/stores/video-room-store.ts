/**
 * Video Room Store (Zustand)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ALL video room + call state lives here — NOT in useState.         ║
 * ║  The useVideoRoom / useVideoCall hooks read/write via this store.  ║
 * ║  Components subscribe to individual slices for minimal re-renders. ║
 * ║                                                                    ║
 * ║  INVARIANT: No component may use useState for:                     ║
 * ║    room, participants, tracks, call status, permissions, media.    ║
 * ║  Derived state must use Zustand selectors.                         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { create } from "zustand";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";
import type {
  VideoRoom,
  Participant,
  ConnectionState,
  EjectPayload,
  MemberRole,
} from "../types";

// ── Call lifecycle phases (strict state machine) ─────────────────────

export type CallPhase =
  | "idle" // No call in progress
  | "requesting_perms" // Awaiting camera/mic OS permissions
  | "perms_denied" // User denied permissions — blocked
  | "creating_room" // Edge function: create room
  | "joining_room" // Edge function: join room + get token
  | "connecting_peer" // Fishjam: connecting WebRTC peer
  | "starting_media" // Starting camera/mic tracks
  | "outgoing_ringing" // Caller: media ready, waiting for callee to answer+join
  | "connected" // Fully connected, media flowing
  | "reconnecting" // Temporary disconnect, auto-recovering
  | "call_ended" // Call ended — show summary UI
  | "error"; // Unrecoverable error — show error UI

export type CallType = "audio" | "video";

export type CallRole = "caller" | "callee";
export type CallDirection = "incoming" | "outgoing";

export type PermissionState = "pending" | "granted" | "denied";

export interface RecipientInfo {
  username: string;
  avatar?: string;
}

// ── State shape ──────────────────────────────────────────────────────

interface LocalUser {
  id: string;
  username?: string;
  displayName?: string;
  avatar?: string;
  role: MemberRole;
  peerId?: string;
  isAnonymous?: boolean;
  anonLabel?: string | null;
}

interface VideoRoomStoreState {
  // Room data
  room: VideoRoom | null;
  roomId: string | null;
  localUser: LocalUser | null;
  participants: Participant[];

  // Connection
  connectionState: ConnectionState;

  // Call lifecycle
  callPhase: CallPhase;
  callType: CallType;
  callRole: CallRole;
  callDirection: CallDirection;
  chatId: string | null;
  callEnded: boolean;
  callDuration: number;
  callStartedAt: number | null;
  recipientInfo: RecipientInfo | null;

  // Permissions
  cameraPermission: PermissionState;
  micPermission: PermissionState;

  // Media
  isCameraOn: boolean;
  isMicOn: boolean;
  isFrontCamera: boolean;
  isSpeakerOn: boolean;
  localStream: MediaStream | null;

  // PiP
  isPiPActive: boolean;

  // Error
  error: string | null;
  errorCode: string | null;

  // Eject
  isEjected: boolean;
  ejectReason?: EjectPayload;
}

interface VideoRoomStoreActions {
  // Room
  setRoom: (room: VideoRoom | null) => void;
  setRoomId: (roomId: string | null) => void;
  setLocalUser: (user: LocalUser | null) => void;
  setParticipants: (participants: Participant[]) => void;

  // Connection — bails out if status unchanged
  setConnectionStatus: (
    status: ConnectionState["status"],
    error?: string,
  ) => void;

  // Call lifecycle
  setCallPhase: (phase: CallPhase) => void;
  setCallType: (type: CallType) => void;
  setCallRole: (role: CallRole) => void;
  setCallDirection: (direction: CallDirection) => void;
  setRecipientInfo: (info: RecipientInfo | null) => void;
  setChatId: (chatId: string | null) => void;
  setCallEnded: (duration: number) => void;
  setCallDuration: (duration: number) => void;
  setCallStartedAt: (ts: number | null) => void;

  // Permissions
  setCameraPermission: (state: PermissionState) => void;
  setMicPermission: (state: PermissionState) => void;

  // Media
  setCameraOn: (on: boolean) => void;
  setMicOn: (on: boolean) => void;
  toggleCamera: () => void;
  toggleMic: () => void;
  setFrontCamera: (front: boolean) => void;
  toggleFrontCamera: () => void;
  setSpeakerOn: (on: boolean) => void;
  setLocalStream: (stream: MediaStream | null) => void;

  // PiP
  setIsPiPActive: (active: boolean) => void;

  // Escalation (audio → video)
  escalateToVideo: () => void;

  // Error
  setError: (message: string, code?: string) => void;
  clearError: () => void;

  // Eject
  setEjected: (payload: EjectPayload) => void;
  setRoomEnded: () => void;

  // Reset
  reset: () => void;
}

export type VideoRoomStore = VideoRoomStoreState & VideoRoomStoreActions;

// ── Initial state ────────────────────────────────────────────────────

const initialState: VideoRoomStoreState = {
  room: null,
  roomId: null,
  localUser: null,
  participants: [],
  connectionState: { status: "disconnected" },
  callPhase: "idle",
  callType: "video",
  callRole: "caller",
  callDirection: "outgoing",
  chatId: null,
  callEnded: false,
  callDuration: 0,
  callStartedAt: null,
  recipientInfo: null,
  cameraPermission: "pending",
  micPermission: "pending",
  isCameraOn: false,
  isMicOn: false,
  isFrontCamera: true,
  isSpeakerOn: true,
  localStream: null,
  isPiPActive: false,
  error: null,
  errorCode: null,
  isEjected: false,
  ejectReason: undefined,
};

// ── Store ────────────────────────────────────────────────────────────

export const useVideoRoomStore = create<VideoRoomStore>((set, get) => ({
  ...initialState,

  setRoom: (room) => set({ room }),
  setRoomId: (roomId) => set({ roomId }),

  setLocalUser: (localUser) => set({ localUser }),

  setParticipants: (participants) => {
    const prev = get().participants;
    // CRITICAL FIX: The bailout logic was TOO strict — it prevented updates when
    // a remote peer's track.stream went from null → MediaStream (async negotiation).
    // Now we ONLY bail if:
    //   1. Same number of participants
    //   2. Same userId order
    //   3. Same track EXISTENCE (not stream identity)
    //   4. If tracks exist, same stream identity OR both null
    //
    // This allows the update to propagate when:
    //   - A track goes from null → populated stream (async WebRTC negotiation)
    //   - A track goes from stream A → stream B (camera switch, etc.)
    if (
      prev.length === participants.length &&
      prev.every((p, i) => {
        const curr = participants[i];
        if (!curr) return false;
        if (p.userId !== curr.userId) return false;
        if (p.isCameraOn !== curr.isCameraOn) return false;
        if (p.isMicOn !== curr.isMicOn) return false;

        // CRITICAL: Detect ANY change in video/audio stream identity.
        // This catches: null→stream, undefined→stream, streamA→streamB
        const prevVidStream = p.videoTrack?.stream ?? null;
        const currVidStream = curr.videoTrack?.stream ?? null;
        if (prevVidStream !== currVidStream) return false;

        const prevVidTrack = p.videoTrack?.track ?? null;
        const currVidTrack = curr.videoTrack?.track ?? null;
        if (prevVidTrack !== currVidTrack) return false;

        const prevVidTrackId = p.videoTrack?.trackId ?? prevVidTrack?.id ?? null;
        const currVidTrackId =
          curr.videoTrack?.trackId ?? currVidTrack?.id ?? null;
        if (prevVidTrackId !== currVidTrackId) return false;

        const prevAudStream = p.audioTrack?.stream ?? null;
        const currAudStream = curr.audioTrack?.stream ?? null;
        if (prevAudStream !== currAudStream) return false;

        const prevAudTrack = p.audioTrack?.track ?? null;
        const currAudTrack = curr.audioTrack?.track ?? null;
        if (prevAudTrack !== currAudTrack) return false;

        const prevAudTrackId = p.audioTrack?.trackId ?? prevAudTrack?.id ?? null;
        const currAudTrackId =
          curr.audioTrack?.trackId ?? currAudTrack?.id ?? null;
        if (prevAudTrackId !== currAudTrackId) return false;

        return true;
      })
    ) {
      return; // no-op, prevents unnecessary re-renders
    }
    set({ participants });
  },

  setConnectionStatus: (status, error) => {
    const prev = get().connectionState;
    if (prev.status === status && prev.error === error) return; // bail out
    set({ connectionState: { status, error } });
  },

  // Call lifecycle
  setCallPhase: (callPhase) => {
    const prev = get().callPhase;
    if (prev === callPhase) return;
    console.log(`[VideoStore] Phase: ${prev} → ${callPhase}`);
    set({ callPhase });
  },
  setCallType: (callType) => set({ callType }),
  setCallRole: (callRole) => set({ callRole }),
  setCallDirection: (callDirection) => set({ callDirection }),
  setRecipientInfo: (recipientInfo) => set({ recipientInfo }),
  setChatId: (chatId) => set({ chatId }),
  setCallEnded: (duration) =>
    set({
      callPhase: "call_ended",
      callEnded: true,
      callDuration: duration,
      localStream: null,
      participants: [],
    }),
  setCallDuration: (callDuration) => set({ callDuration }),
  setCallStartedAt: (callStartedAt) => set({ callStartedAt }),

  // Permissions
  setCameraPermission: (cameraPermission) => set({ cameraPermission }),
  setMicPermission: (micPermission) => set({ micPermission }),

  // Media — with audio-mode guard
  setCameraOn: (isCameraOn) => {
    const { callType } = get();
    if (isCameraOn && callType === "audio") {
      console.error(
        "[VideoStore] INVARIANT VIOLATION: setCameraOn(true) called in audio mode. " +
          "Camera MUST NOT be enabled during audio calls. Use escalateToVideo() first.",
      );
      return; // Block — do NOT enable camera in audio mode
    }
    set({ isCameraOn });
  },
  setMicOn: (isMicOn) => set({ isMicOn }),
  toggleCamera: () => {
    const { callType, isCameraOn } = get();
    if (!isCameraOn && callType === "audio") {
      console.error(
        "[VideoStore] INVARIANT VIOLATION: toggleCamera() in audio mode. " +
          "Use escalateToVideo() to upgrade call first.",
      );
      return;
    }
    set({ isCameraOn: !isCameraOn });
  },
  toggleMic: () => set((s) => ({ isMicOn: !s.isMicOn })),
  setFrontCamera: (isFrontCamera) => set({ isFrontCamera }),
  toggleFrontCamera: () => set((s) => ({ isFrontCamera: !s.isFrontCamera })),
  setSpeakerOn: (isSpeakerOn) => set({ isSpeakerOn }),
  setLocalStream: (localStream) => set({ localStream }),

  // PiP
  setIsPiPActive: (isPiPActive) => set({ isPiPActive }),

  // Escalation (audio → video) — explicit mode transition
  escalateToVideo: () => {
    const prev = get();
    if (prev.callType === "video") return; // already video
    console.log("[VideoStore] Escalating call: audio → video");
    set({ callType: "video" });
  },

  // Error
  setError: (message, code) => {
    console.error(`[VideoStore] ERROR [${code || "unknown"}]: ${message}`);
    set({ error: message, errorCode: code || null, callPhase: "error" });
  },
  clearError: () => set({ error: null, errorCode: null }),

  setEjected: (ejectReason) => {
    if (get().isEjected) return; // already ejected, bail
    set({
      isEjected: true,
      ejectReason,
      connectionState: { status: "disconnected" },
      callPhase: "call_ended",
    });
  },

  setRoomEnded: () => {
    const prev = get();
    set({
      room: prev.room ? { ...prev.room, status: "ended" } : null,
      connectionState: { status: "disconnected" },
      callPhase: "call_ended",
    });
  },

  reset: () => set(initialState),
}));
