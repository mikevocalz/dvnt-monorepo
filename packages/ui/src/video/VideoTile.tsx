/**
 * VideoTile — the shared, transport-agnostic media tile for DVNT.
 *
 * One contract, three backends (resolved by Metro/web at build time):
 *   - `.web.tsx`   → MoQ canvas (`canvasRef`) OR MediaStream `<video>` OR avatar
 *   - `.native.tsx`→ MoQ WebView player (`moqViewer`) OR `RTCView` stream OR avatar
 *
 * A Lynk (MoQ livestream) tile and a Call (Fishjam WebRTC) tile render through
 * the SAME component so screens stay transport-agnostic — pass exactly one media
 * source. Avatars in DVNT are rounded SQUARES, never circular.
 *
 * This base file is the TypeScript resolution target + the prop contract; the
 * platform files provide the real rendering.
 */

export type { MoqViewerSource, VideoTileProps } from "./VideoTile.types";
import type { VideoTileProps } from "./VideoTile.types";

/**
 * Base implementation is intentionally inert — Metro/web always resolve a
 * platform file. Kept so bare `import { VideoTile } from "@dvnt/ui"` typechecks.
 */
export function VideoTile(_props: VideoTileProps): null {
  return null;
}
