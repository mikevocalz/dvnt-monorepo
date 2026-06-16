/**
 * Shared prop contract for the VideoTile platform split. Lives in a non-split
 * file so the base / .web / .native files + the package index can all import it
 * without `./VideoTile` resolving back to a platform sibling under
 * platform-suffix module resolution (e.g. apps/web's moduleSuffixes).
 */

export interface MoqViewerSource {
  /** Fishjam relay URL incl. `?jwt=` (subscribe-scoped) for the WebView player. */
  relayUrl: string;
  /** Room namespace the player subscribes to for publisher discovery. */
  namespace: string;
  muted?: boolean;
  /** 0–1. */
  volume?: number;
}

export interface VideoTileProps {
  /** WebRTC/MediaStream source → `<video>` (web) / `RTCView` (native). */
  stream?: MediaStream | null;
  /** MoQ WEB canvas sink — callback ref to bind the WebCodecs decoder's canvas. */
  canvasRef?: (el: HTMLCanvasElement | null) => void;
  /** MoQ NATIVE viewer — render a WebView-hosted `@moq` player. */
  moqViewer?: MoqViewerSource;
  mirror?: boolean;
  objectFit?: "cover" | "contain";
  /** Mute the tile's own audio playback (local preview should pass true). */
  muted?: boolean;
  className?: string;
  /** Fallback chrome shown when there is no live media. */
  label?: string;
  avatarUrl?: string | null;
  /** Cyan speaking ring (matches the existing room UI). */
  isSpeaking?: boolean;
}
