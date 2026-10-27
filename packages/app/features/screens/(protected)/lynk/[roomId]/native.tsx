/**
 * Lynk Live — NATIVE screen. TRUE native MoQ transport via `react-native-moq`
 * (WS-3; web uses `@moq/*` directly, and the two interop). Publish + watch are
 * native QUIC with hardware encode/decode — no WebView, no WHIP/WHEP.
 *
 * Transport is hidden behind `useLynkBroadcast`/`useLynkViewer` (native) +
 * `<PublisherView>`/`<PublisherTile>`; this screen only differs from web in
 * chrome (safe-area, full-bleed, overlay controls). Reuses the existing private
 * Lynk room model. `?isHost=1` (or a publish-capable role) → broadcaster;
 * otherwise viewer.
 */

import { useEffect, useState } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useGenesisRoomAdmission, type GenesisRoomAdmission } from "@dvnt/app/features/sneaky-lynk/useGenesisRoomAdmission";
import { isPublisherRole } from "@dvnt/app/features/sneaky-lynk/publish-roles";
import { View, Text, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PublisherView } from "react-native-moq";
import { useLynkBroadcast } from "@dvnt/app/lib/lynk/useLynkBroadcast.native";
import { useLynkViewer } from "@dvnt/app/lib/lynk/useLynkViewer.native";
import { lynkStateLabel } from "@dvnt/app/lib/lynk/lynkState";
import { CaptureErrorBanner } from "@dvnt/app/features/sneaky-lynk/ui/CaptureErrorBanner";
import { PublisherTile } from "./PublisherTile.native";

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <View className="rounded-full bg-black/60 px-3 py-1">
      <Text className="text-xs font-semibold text-white">{children}</Text>
    </View>
  );
}

function BroadcasterStage({ roomId, session }: { roomId: string; session: GenesisRoomAdmission }) {
  const insets = useSafeAreaInsets();
  const [captureOptIn, setCaptureOptIn] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const lynk = useLynkBroadcast(roomId, captureOptIn && isPublisherRole(session.role));
  useEffect(() => {
    if (captureOptIn && !lynk.isLive) void lynk.goLive();
  }, [captureOptIn, lynk.isLive, lynk.goLive]);
  useEffect(() => {
    if (captureOptIn && lynk.error) {
      setCaptureError(lynk.error);
      setCaptureOptIn(false);
    }
  }, [captureOptIn, lynk.error]);
  useEffect(() => session.onTransportState(lynk.state), [lynk.state, session.onTransportState]);

  return (
    <View className="flex-1 bg-[#06070d]">
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingTop: insets.top + 8 }}>
        <View className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
          <PublisherView camera={lynk.cameraTrack} style={{ flex: 1 }} />
          <View className="absolute bottom-2 left-2 rounded-full bg-black/60 px-3 py-1">
            <Text className="text-xs font-semibold text-white">You</Text>
          </View>
        </View>
        <CaptureErrorBanner error={lynk.captureError} onRetry={lynk.retryCapture} />
        {lynk.coPublishers.map((p) => (
          <PublisherTile key={p.peerId} broadcast={p.broadcast} label="Cohost" />
        ))}
      </ScrollView>

      <View
        className="absolute left-0 right-0 flex-row items-center justify-between px-4"
        style={{ top: insets.top + 8 }}
      >
        <Pill>
          <Text className="text-[#FC253A]">● </Text>
          {lynkStateLabel(lynk.state, "broadcaster")}
        </Pill>
        <Pressable
          disabled={session.leaving}
          onPress={() => void session.leave()}
          className="rounded-full bg-[#FC253A] px-4 py-1.5"
        >
          <Text className="text-xs font-semibold text-white">{session.leaving ? "Ending…" : session.role === "host" ? "End" : "Leave"}</Text>
        </Pressable>
      </View>

      <View
        className="absolute left-0 right-0 flex-row items-center justify-center gap-3 px-4"
        style={{ bottom: insets.bottom + 16 }}
      >
        {!captureOptIn || !lynk.isLive ? (
          <Pressable disabled={captureOptIn} onPress={() => { setCaptureError(null); setCaptureOptIn(true); }} className="rounded-full bg-[#3FDCFF] px-6 py-3">
            <Text className="text-sm font-bold text-black">{captureOptIn ? "Connecting…" : "Go Live"}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={() => lynk.setCameraEnabled(!lynk.cameraEnabled)}
              className="rounded-full bg-white/10 px-5 py-3"
            >
              <Text className="text-sm font-semibold text-white">
                {lynk.cameraError ? "Camera unavailable" : lynk.cameraEnabled ? "Camera off" : "Camera on"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => lynk.setMicEnabled(!lynk.micEnabled)}
              className="rounded-full bg-white/10 px-5 py-3"
            >
              <Text className="text-sm font-semibold text-white">
                {lynk.microphoneError ? "Mic unavailable" : lynk.micEnabled ? "Mute" : "Unmute"}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {captureError || lynk.error ? (
        <View className="absolute left-0 right-0 items-center px-4" style={{ bottom: insets.bottom + 72 }}>
          <Text className="text-center text-sm text-[#FC253A]">{captureError || lynk.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ViewerStage({ roomId, session }: { roomId: string; session: GenesisRoomAdmission }) {
  const insets = useSafeAreaInsets();
  const lynk = useLynkViewer(roomId);
  useEffect(() => session.onTransportState(lynk.state), [lynk.state, session.onTransportState]);
  const empty = lynk.publishers.length === 0;

  return (
    <View className="flex-1 bg-[#06070d]">
      {empty ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-white/60">{lynkStateLabel(lynk.state, "viewer")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingTop: insets.top + 48 }}>
          {lynk.publishers.map((p, i) => (
            <PublisherTile
              key={p.peerId}
              broadcast={p.broadcast}
              label={i === 0 ? "Host" : "Cohost"}
            />
          ))}
        </ScrollView>
      )}

      <View
        className="absolute left-0 right-0 flex-row items-center justify-between px-4"
        style={{ top: insets.top + 8 }}
      >
        <Pill>
          <Text className="text-[#FC253A]">● </Text>
          {lynkStateLabel(lynk.state, "viewer")}
        </Pill>
        <View className="flex-row gap-2">
          <Pressable onPress={() => lynk.setMuted(!lynk.muted)} className="rounded-full bg-black/60 px-3 py-1">
            <Text className="text-xs font-semibold text-white">{lynk.muted ? "Unmute" : "Mute"}</Text>
          </Pressable>
          <Pressable
            disabled={session.leaving}
            onPress={() => void session.leave()}
            className="rounded-full bg-black/60 px-3 py-1"
          >
            <Text className="text-xs font-semibold text-white">{session.leaving ? "Ending…" : session.role === "host" ? "End" : "Leave"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function AdmittedRoom({ roomId, requestedBroadcast }: { roomId: string; requestedBroadcast: boolean }) {
  const router = useRouter();
  const session = useGenesisRoomAdmission(roomId, () => router.back());
  return (
    <View className="flex-1 bg-[#06070d]">
      {session.admitted ? (
        requestedBroadcast && isPublisherRole(session.role)
          ? <BroadcasterStage key={session.mediaKey} roomId={roomId} session={session} />
          : <ViewerStage key={session.mediaKey} roomId={roomId} session={session} />
      ) : (
        <View className="flex-1 items-center justify-center gap-4 p-6">
          <Text accessibilityRole="text" className="text-center text-white">{session.message || (session.phase === "joining" ? "Joining Lynk…" : "Lynk paused")}</Text>
          {session.phase === "error" && <Pressable onPress={() => void session.join()}
            className="rounded-full bg-[#3FDCFF] px-6 py-3"><Text className="font-bold text-black">Try again</Text></Pressable>}
          <Pressable onPress={() => void session.leave()} className="rounded-full bg-white/10 px-6 py-3"><Text className="text-white">Leave</Text></Pressable>
        </View>
      )}
      {session.admitted && session.message && <Text accessibilityRole="alert" className="p-4 text-center text-[#FC253A]">{session.message}</Text>}
    </View>
  );
}

export default function LynkRoomNative() {
  const params = useLocalSearchParams<{ roomId?: string; isHost?: string }>();
  const account = useAuthStore((state) => state.user?.authId || state.user?.id || "");
  const roomId = String(params.roomId ?? "");
  if (!roomId) return <View className="flex-1 items-center justify-center bg-[#06070d]"><Text className="text-white/60">Missing room</Text></View>;
  return <AdmittedRoom key={JSON.stringify([roomId, account])} roomId={roomId} requestedBroadcast={params.isHost === "1"} />;
}
