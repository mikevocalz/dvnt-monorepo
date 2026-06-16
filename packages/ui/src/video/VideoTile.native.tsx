/**
 * VideoTile (NATIVE) — renders, in priority order:
 *   1. `moqViewer`  → a WebView-hosted `@moq` player (the Lynk Live mobile viewer
 *      path from docs/lynk-moq-fit.md §6.1; canvas decoding happens inside the
 *      WebView, controls bridged via postMessage).
 *   2. avatar fallback (rounded SQUARE).
 *
 * Priority:
 *   1. `stream` (native MediaStream) → `RTCView` — the Lynk Live native viewer/
 *      broadcaster-preview tile (Fishjam WHIP/WHEP), and the shared call tile.
 *   2. `moqViewer` → WebView-hosted `@moq` player (kept as the pure-MoQ-on-native
 *      fallback; unused once native uses Fishjam livestream).
 *   3. avatar fallback (rounded SQUARE).
 */

import { useMemo, useRef, useEffect } from "react";
import { View, Text, Image } from "react-native";
import { WebView } from "react-native-webview";
// RTCView renders a native MediaStream; a video tile legitimately depends on the
// video lib (the calling feature's tile uses the same import).
import { RTCView } from "@fishjam-cloud/react-native-client";
import type { VideoTileProps } from "./VideoTile.types";
import { buildMoqPlayerHtml } from "./moqPlayerHtml";

export function VideoTile({
  stream,
  moqViewer,
  mirror,
  objectFit = "cover",
  className,
  label,
  avatarUrl,
  isSpeaking,
}: VideoTileProps) {
  const webRef = useRef<WebView>(null);

  const html = useMemo(
    () =>
      moqViewer
        ? buildMoqPlayerHtml({
            relayUrl: moqViewer.relayUrl,
            namespace: moqViewer.namespace,
            muted: moqViewer.muted,
            volume: moqViewer.volume,
          })
        : null,
    [moqViewer?.relayUrl, moqViewer?.namespace],
  );

  // Bridge mute/volume changes into the running player.
  useEffect(() => {
    if (!moqViewer || !webRef.current) return;
    webRef.current.postMessage(
      JSON.stringify({
        type: "control",
        muted: moqViewer.muted,
        volume: moqViewer.volume,
      }),
    );
  }, [moqViewer?.muted, moqViewer?.volume, moqViewer]);

  const ring = isSpeaking ? "border-2 border-[#3FDCFF]" : "border-0";

  return (
    <View className={`relative overflow-hidden rounded-2xl bg-black ${ring} ${className ?? ""}`}>
      {stream ? (
        <RTCView
          // @ts-expect-error - RTCView stream prop types vary between versions
          stream={stream}
          style={{ flex: 1 }}
          objectFit={objectFit}
          mirror={mirror}
        />
      ) : html ? (
        <WebView
          ref={webRef}
          originWhitelist={["*"]}
          source={{ html }}
          style={{ flex: 1, backgroundColor: "#06070d" }}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          javaScriptEnabled
          domStorageEnabled
        />
      ) : (
        <View className="absolute inset-0 items-center justify-center bg-[#0d0f17]">
          {avatarUrl ? (
            <Image
              source={{ uri: avatarUrl }}
              className="h-20 w-20 rounded-2xl"
              resizeMode="cover"
            />
          ) : (
            <View className="h-20 w-20 items-center justify-center rounded-2xl bg-[#1b1f2b]">
              <Text className="text-2xl font-semibold text-white/70">
                {(label ?? "?").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
      )}

      {label ? (
        <View className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5">
          <Text className="text-xs font-medium text-white">{label}</Text>
        </View>
      ) : null}
    </View>
  );
}
