/**
 * react-native-moq — WEB shim.
 *
 * `react-native-moq` is a TurboModule package: importing it in the browser
 * bundle fails the build with "'TurboModuleRegistry' is not exported from
 * 'react-native'". Shared code legitimately imports it (the Lynk room's native
 * transport), and barrels are platform-blind — `features/sneaky-lynk/index.ts`
 * reaches `messages.web.tsx`, so the import edge exists even though no web
 * screen renders a MoQ tile.
 *
 * Web has its OWN MoQ implementation via `@moq/*` in `useLynkBroadcast.web.ts`
 * and `useLynkViewer.web.ts`; this shim exists purely to cut the module edge,
 * never to serve traffic.
 *
 * Everything here throws instead of returning an inert object. A silent no-op
 * player looks exactly like a stream that never arrives — the most expensive
 * class of bug to chase — so if a web screen ever does reach this, it says so
 * at the call site with the name of the thing to use instead.
 */

const USE_WEB_HOOKS =
  "react-native-moq is native-only. On web use @dvnt/app/lib/lynk/useLynkBroadcast.web or useLynkViewer.web.";

function nativeOnly(symbol: string): never {
  throw new Error(`${symbol}: ${USE_WEB_HOOKS}`);
}

export function useSession(_url: string): never {
  return nativeOnly("useSession");
}
export function usePublisher(_session: unknown): never {
  return nativeOnly("usePublisher");
}
export function useCamera(_options?: unknown): never {
  return nativeOnly("useCamera");
}
export function useMicrophone(_options?: unknown): never {
  return nativeOnly("useMicrophone");
}
export function useBroadcasts(_session: unknown, _prefix: string): never {
  return nativeOnly("useBroadcasts");
}
export function useVideoPlayer(_broadcast: unknown): never {
  return nativeOnly("useVideoPlayer");
}
export function useAudioPlayer(_broadcast: unknown): never {
  return nativeOnly("useAudioPlayer");
}
export function VideoView(_props: unknown): never {
  return nativeOnly("VideoView");
}
export function PublisherView(_props: unknown): never {
  return nativeOnly("PublisherView");
}

// Types are erased at build time; these keep `import type` sites resolvable.
export type BroadcastInfo = unknown;
export type CameraTrack = unknown;
export type PublishTrack = unknown;
export type SessionState = string;
