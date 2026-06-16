/**
 * Fishjam RTC Client
 * Manages WebRTC connection for Sneaky Lynk rooms
 */

import type { ConnectionState, MemberRole } from "../types";

// Fishjam types (simplified for now - will be replaced by actual SDK types)
export interface FishjamPeer {
  id: string;
  metadata: {
    userId: string;
    role: MemberRole;
    jti: string;
  };
  tracks: FishjamTrack[];
}

export interface FishjamTrack {
  id: string;
  type: "audio" | "video";
  stream?: MediaStream;
  enabled: boolean;
}

export interface FishjamConfig {
  serverUrl: string;
  token: string;
  roomId: string;
}

export type FishjamEventType =
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "peer_joined"
  | "peer_left"
  | "track_added"
  | "track_removed"
  | "active_speaker";

export interface FishjamEvent {
  type: FishjamEventType;
  peer?: FishjamPeer;
  track?: FishjamTrack;
  activeSpeakerId?: string;
}

type EventCallback = (event: FishjamEvent) => void;

/**
 * Fishjam Client Wrapper
 * TODO: Replace with actual @fishjam-cloud/react-native-client when ready
 */
export class FishjamClient {
  private config: FishjamConfig | null = null;
  private connectionState: ConnectionState = "disconnected";
  private peers: Map<string, FishjamPeer> = new Map();
  private localTracks: FishjamTrack[] = [];
  private eventListeners: Map<FishjamEventType, Set<EventCallback>> = new Map();
  private activeSpeakerId: string | null = null;

  constructor() {
    console.log("[Fishjam] Client initialized");
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getPeers(): FishjamPeer[] {
    return Array.from(this.peers.values());
  }

  getLocalTracks(): FishjamTrack[] {
    return this.localTracks;
  }

  getActiveSpeakerId(): string | null {
    return this.activeSpeakerId;
  }

  on(event: FishjamEventType, callback: EventCallback): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
  }

  off(event: FishjamEventType, callback: EventCallback): void {
    this.eventListeners.get(event)?.delete(callback);
  }

  private emit(event: FishjamEvent): void {
    this.eventListeners.get(event.type)?.forEach((cb) => cb(event));
  }

  async connect(config: FishjamConfig): Promise<void> {
    console.log("[Fishjam] Connecting to room:", config.roomId);
    this.config = config;
    this.connectionState = "connecting";

    // TODO: Replace with actual Fishjam SDK connection
    // const client = new FishjamCloudClient();
    // await client.connect(config.serverUrl, config.token);

    // Simulate connection for now
    await new Promise((resolve) => setTimeout(resolve, 500));

    this.connectionState = "connected";
    this.emit({ type: "connected" });
    console.log("[Fishjam] Connected");
  }

  async disconnect(): Promise<void> {
    console.log("[Fishjam] Disconnecting");

    // TODO: Replace with actual Fishjam SDK disconnect
    // await this.client?.disconnect();

    this.connectionState = "disconnected";
    this.peers.clear();
    this.localTracks = [];
    this.emit({ type: "disconnected" });
  }

  async enableAudio(): Promise<void> {
    console.log("[Fishjam] Enabling audio");

    // TODO: Replace with actual Fishjam SDK
    // await this.client?.enableMicrophone();

    const audioTrack: FishjamTrack = {
      id: `local-audio-${Date.now()}`,
      type: "audio",
      enabled: true,
    };
    this.localTracks = this.localTracks.filter((t) => t.type !== "audio");
    this.localTracks.push(audioTrack);
  }

  async disableAudio(): Promise<void> {
    console.log("[Fishjam] Disabling audio");

    // TODO: Replace with actual Fishjam SDK
    // await this.client?.disableMicrophone();

    this.localTracks = this.localTracks.filter((t) => t.type !== "audio");
  }

  async enableVideo(): Promise<void> {
    console.log("[Fishjam] Enabling video");

    // TODO: Replace with actual Fishjam SDK
    // await this.client?.enableCamera();

    const videoTrack: FishjamTrack = {
      id: `local-video-${Date.now()}`,
      type: "video",
      enabled: true,
    };
    this.localTracks = this.localTracks.filter((t) => t.type !== "video");
    this.localTracks.push(videoTrack);
  }

  async disableVideo(): Promise<void> {
    console.log("[Fishjam] Disabling video");

    // TODO: Replace with actual Fishjam SDK
    // await this.client?.disableCamera();

    this.localTracks = this.localTracks.filter((t) => t.type !== "video");
  }

  isAudioEnabled(): boolean {
    return this.localTracks.some((t) => t.type === "audio" && t.enabled);
  }

  isVideoEnabled(): boolean {
    return this.localTracks.some((t) => t.type === "video" && t.enabled);
  }

  // Simulate active speaker detection (will be replaced by Fishjam events)
  simulateActiveSpeaker(peerId: string | null): void {
    this.activeSpeakerId = peerId;
    this.emit({ type: "active_speaker", activeSpeakerId: peerId ?? undefined });
  }
}

// Singleton instance
let fishjamClient: FishjamClient | null = null;

export function getFishjamClient(): FishjamClient {
  if (!fishjamClient) {
    fishjamClient = new FishjamClient();
  }
  return fishjamClient;
}

export function resetFishjamClient(): void {
  if (fishjamClient) {
    fishjamClient.disconnect();
    fishjamClient = null;
  }
}
