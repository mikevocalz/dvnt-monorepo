/**
 * Lynk Live — NATIVE screen. TRUE native transport via Fishjam WHIP/WHEP
 * livestream (docs/lynk-moq-fit.md §6.1; web uses MoQ). Publish + watch render
 * real native `MediaStream`s in `RTCView` — no WebView.
 *
 * Transport is hidden behind `useLynkBroadcast`/`useLynkViewer` (native) +
 * `<VideoTile>`; this screen only differs from web in chrome (safe-area,
 * full-bleed, overlay controls). Reuses the existing private Lynk room model.
 * `?isHost=1` (or a publish-capable role) → broadcaster; otherwise viewer.
 */

import { View, Text, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { FishjamProvider } from "@fishjam-cloud/react-native-client";
import { VideoTile } from "@dvnt/ui";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";
import { useLynkBroadcast } from "@dvnt/app/lib/lynk/useLynkBroadcast.native";
import { useLynkViewer } from "@dvnt/app/lib/lynk/useLynkViewer.native";
import { lynkStateLabel } from "@dvnt/app/lib/lynk/lynkState";
import { LivestreamTile } from "./LivestreamTile.native";

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <View className="rounded-full bg-black/60 px-3 py-1">
      <Text className="text-xs font-semibold text-white">{children}</Text>
    </View>
  );
}

function BroadcasterStage({ roomId }: { roomId: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const lynk = useLynkBroadcast(roomId);

  return (
    <View className="flex-1 bg-[#06070d]">
      <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingTop: insets.top + 8 }}>
        <VideoTile
          stream={(lynk.localStream ?? undefined) as unknown as MediaStream}
          mirror
          muted
          label="You"
          isSpeaking={lynk.cameraEnabled}
          className="aspect-video w-full"
        />
        {lynk.coPublishers.map((p) => (
          <LivestreamTile key={p.peerId} token={p.token} label="Cohost" />
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
          onPress={() => {
            lynk.end();
            router.back();
          }}
          className="rounded-full bg-[#FC253A] px-4 py-1.5"
        >
          <Text className="text-xs font-semibold text-white">End</Text>
        </Pressable>
      </View>

      <View
        className="absolute left-0 right-0 flex-row items-center justify-center gap-3 px-4"
        style={{ bottom: insets.bottom + 16 }}
      >
        {!lynk.isLive ? (
          <Pressable onPress={() => void lynk.goLive()} className="rounded-full bg-[#3FDCFF] px-6 py-3">
            <Text className="text-sm font-bold text-black">Go Live</Text>
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={() => lynk.setCameraEnabled(!lynk.cameraEnabled)}
              className="rounded-full bg-white/10 px-5 py-3"
            >
              <Text className="text-sm font-semibold text-white">
                {lynk.cameraEnabled ? "Camera off" : "Camera on"}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => lynk.setMicEnabled(!lynk.micEnabled)}
              className="rounded-full bg-white/10 px-5 py-3"
            >
              <Text className="text-sm font-semibold text-white">
                {lynk.micEnabled ? "Mute" : "Unmute"}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {lynk.error ? (
        <View className="absolute left-0 right-0 items-center px-4" style={{ bottom: insets.bottom + 72 }}>
          <Text className="text-center text-sm text-[#FC253A]">{lynk.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ViewerStage({ roomId }: { roomId: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const lynk = useLynkViewer(roomId);
  const empty = lynk.publishers.length === 0;

  return (
    <View className="flex-1 bg-[#06070d]">
      {empty ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-white/60">{lynkStateLabel(lynk.state, "viewer")}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 12, gap: 12, paddingTop: insets.top + 48 }}>
          {lynk.publishers.map((p) => (
            <LivestreamTile
              key={p.peerId}
              token={p.token}
              label={p.role === "host" ? "Host" : "Cohost"}
              muted={lynk.muted}
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
            onPress={() => {
              lynk.leave();
              router.back();
            }}
            className="rounded-full bg-black/60 px-3 py-1"
          >
            <Text className="text-xs font-semibold text-white">Leave</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function LynkRoomNative() {
  const params = useLocalSearchParams<{ roomId?: string; isHost?: string }>();
  const roomId = String(params.roomId ?? "");
  const isHost = params.isHost === "1";

  if (!roomId) {
    return (
      <View className="flex-1 items-center justify-center bg-[#06070d]">
        <Text className="text-white/60">Missing room</Text>
      </View>
    );
  }

  return (
    <FishjamProvider fishjamId={resolveFishjamAppId()}>
      {isHost ? <BroadcasterStage roomId={roomId} /> : <ViewerStage roomId={roomId} />}
    </FishjamProvider>
  );
}
