/**
 * useVideoRoom — WEB.
 *
 * The web room does not use this hook. `video-room.web.tsx` drives the room from
 * `useVideoRoomStore` directly and owns its own transport; the only reason this
 * file exists is that `features/video/index.ts` re-exports the hook with
 * `export *`, and a barrel is platform-blind.
 *
 * Without this sibling, webpack resolves the native file and pulls
 * `react-native-moq` — a TurboModule — into the browser bundle, which fails the
 * build with "'TurboModuleRegistry' is not exported from 'react-native'".
 * `.web.ts` wins on web (apps/web/next.config.ts:263), so this cuts the edge.
 *
 * It throws rather than returning a null-object: a silent no-op room would look
 * like a connection that never lands, which is the most expensive kind of bug to
 * chase. Nothing on web calls it today, so the throw is unreachable by design.
 */

export function useVideoRoom(_options: {
  roomId: string;
  anonymous?: boolean;
  onEjected?: (reason: unknown) => void;
  onRoomEnded?: () => void;
  onError?: (message: string, envelope?: unknown) => void;
}): never {
  throw new Error(
    "useVideoRoom is native-only. On web the room is driven by video-room.web.tsx via useVideoRoomStore.",
  );
}
