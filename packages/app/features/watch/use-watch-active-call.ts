import { useEffect, useRef } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVideoRoomStore } from "@dvnt/app/features/video";
import { useWatchSessionStore } from "./watch-session-store";
import { useWatchSettingsStore } from "./watch-settings-store";
import { pushActiveCall, registerWatchActiveCallHandler } from "./watch-bridge";
import { microphoneMatches, activeCallPhase, validateActiveCallCommand, type WatchActiveCallEnvelope, type WatchActiveCallResult } from "./watch-active-call";
interface ActiveCallBinding {
  ownedRoom: { current: string | null };
  ownedGeneration: { current: string | null };
  peerStatus: string;
  tracks: () => Array<{ enabled: boolean; readyState?: string }>;
  toggleMute: () => void;
  leaveCall: () => void;
}
/** Installed only by the instance that successfully joined the Calls API. */
export function useWatchActiveCall(binding: ActiveCallBinding) {
  const current = useRef(binding); current.current = binding;
  const roomId = useVideoRoomStore((s) => s.roomId);
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const generation = useWatchSessionStore((s) => s.accountGen);
  const enabled = useWatchSettingsStore((s) => s.enabled && s.calls);
  useEffect(() => {
    if (!viewer || !roomId || current.current.ownedGeneration.current !== generation || current.current.ownedRoom.current !== roomId) return;
    const same = () => current.current.ownedGeneration.current === generation && useAuthStore.getState().user?.id === viewer && useWatchSessionStore.getState().accountGen === generation && current.current.ownedRoom.current === roomId && useVideoRoomStore.getState().roomId === roomId;
    const snapshot = (): WatchActiveCallEnvelope => {
      const s = useVideoRoomStore.getState(); const b = current.current; const tracks = b.tracks(); const now = Date.now() / 1000;
      const ended = !same() || !enabled || ["call_ended", "idle", "error"].includes(s.callPhase);
      const phase = activeCallPhase(ended, b.peerStatus, s.callPhase, s.participants.length);
      return { protocol: 2, accountGen: generation, syncedAt: now, expiresAt: now + 30, roomId, phase,
        peerStatus: b.peerStatus, name: s.recipientInfo?.username || "DVNT Call", isVideo: s.callType === "video",
        muted: tracks.length > 0 ? tracks.every((t) => !t.enabled) : !s.isMicOn,
        canMute: !ended && b.peerStatus === "connected" && tracks.some((t) => t.readyState !== "ended") };
    };
    const publish = () => { if (useWatchSessionStore.getState().accountGen === generation) void pushActiveCall(snapshot()); };
    publish();
    const unsubscribe = useVideoRoomStore.subscribe(publish);
    const timer = setInterval(publish, 10_000);
    const results = new Map<string, WatchActiveCallResult>();
    const off = registerWatchActiveCallHandler(async (raw) => {
      const command = validateActiveCallCommand(raw, generation, roomId);
      const fields = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const base = { protocol: 2 as const, accountGen: generation, operationId: String(fields.operationId ?? ""), roomId };
      if (!command || !enabled || !same()) return { ...base, status: "rejected", message: "Call changed. Check your phone." };
      const prior = results.get(command.operationId); if (prior) return prior;
      let result: WatchActiveCallResult;
      try {
        const s = useVideoRoomStore.getState(); const b = current.current;
        if (snapshot().phase !== command.expectedStatus) throw new Error("Call status changed. Try again.");
        if (["call_ended", "idle", "error"].includes(s.callPhase)) throw new Error("This call has ended.");
        if (command.action === "end") {
          b.leaveCall();
          if (!useVideoRoomStore.getState().callEnded && useVideoRoomStore.getState().callPhase !== "call_ended") throw new Error("End not confirmed. Check your phone.");
        } else {
          const tracks = b.tracks();
          if (b.peerStatus !== "connected" || !tracks.length || tracks.some((t) => t.readyState === "ended")) throw new Error("Microphone unavailable. Check your phone.");
          if (!command.muted && s.hostMuteLocked) throw new Error("Microphone is locked on your phone.");
          const desiredMic = !command.muted;
          if (tracks.some((t) => t.enabled !== desiredMic)) {
            // Existing toggle reads store isMicOn. Align to observed track truth
            // first so a desired-state retry can never invert the microphone.
            s.setMicOn(!desiredMic);
            b.toggleMute();
          }
          if (!microphoneMatches(b.tracks(), desiredMic)) throw new Error("Microphone change not confirmed.");
        }
        result = { ...base, status: "confirmed" };
      } catch (error) { result = { ...base, status: "failed", message: error instanceof Error ? error.message : "Check your phone." }; }
      results.set(command.operationId, result); if (results.size > 50) results.delete(results.keys().next().value!);
      publish(); return result;
    });
    return () => { unsubscribe(); clearInterval(timer); off(); };
  }, [roomId, viewer, generation, enabled, binding.ownedRoom.current, binding.ownedGeneration.current, binding.peerStatus]);
}
