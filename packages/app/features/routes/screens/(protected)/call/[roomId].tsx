/**
 * Video Call Screen — FaceTime-Style
 *
 * Thin wrapper that:
 * 1. Reads navigation params
 * 2. Runs deterministic init (perms → create/join)
 * 3. Delegates ALL rendering to CallScreen orchestrator
 *
 * All UI logic, stage rendering, and controls live in
 * src/features/calls/ui/ — this file is intentionally minimal.
 */

import { useEffect, useRef } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useVideoCall, type CallType } from "@dvnt/app/lib/hooks/use-video-call";
import { useMediaPermissions } from "@dvnt/app/src/video/hooks/useMediaPermissions";
import { useVideoRoomStore } from "@dvnt/app/src/video/stores/video-room-store";
import { CT } from "@dvnt/app/src/services/calls/callTrace";
import { CallScreen } from "@dvnt/app/src/features/calls/ui/CallScreen";

export default function VideoCallScreen() {
  const {
    roomId,
    isOutgoing,
    participantIds,
    callType: callTypeParam,
    chatId,
    recipientUsername,
    recipientAvatar,
    isGroup,
  } = useLocalSearchParams<{
    roomId?: string;
    isOutgoing?: string;
    participantIds?: string;
    callType?: string;
    chatId?: string;
    recipientUsername?: string;
    recipientAvatar?: string;
    isGroup?: string;
  }>();

  const { requestPermissions, openSettings } = useMediaPermissions();
  const { createCall, joinCall } = useVideoCall();
  const initCalledRef = useRef(false);

  const initialCallType: CallType =
    callTypeParam === "audio" ? "audio" : "video";
  const isGroupCall =
    isGroup === "true" ||
    (!!participantIds && participantIds.split(",").filter(Boolean).length > 1);

  // ── DETERMINISTIC INIT: perms → room → peer → media ───────────────
  // Guarded: runs once, catches all errors, sets store error on failure.
  useEffect(() => {
    if (initCalledRef.current) return;
    initCalledRef.current = true;

    let cancelled = false;

    const initCall = async () => {
      try {
        CT.trace("LIFECYCLE", "callScreen_init", {
          roomId: roomId ?? undefined,
          isOutgoing: isOutgoing ?? undefined,
          callType: initialCallType,
        });

        const permsOk = await requestPermissions(initialCallType);
        if (!permsOk || cancelled) {
          CT.error("LIFECYCLE", "permsDenied", { callType: initialCallType });
          return;
        }

        if (isOutgoing === "true" && participantIds) {
          const ids = participantIds.split(",");
          await createCall(ids, ids.length > 1, initialCallType, chatId);
        } else if (roomId) {
          await joinCall(roomId, initialCallType);
        } else {
          CT.error("LIFECYCLE", "callScreen_no_params", {
            roomId: roomId ?? "null",
            isOutgoing: isOutgoing ?? "null",
          });
          useVideoRoomStore
            .getState()
            .setError("Missing call parameters", "no_params");
        }
      } catch (err: any) {
        if (cancelled) return;
        CT.error("LIFECYCLE", "callScreen_init_CRASHED", {
          error: err?.message || String(err),
        });
        console.error("[CallScreen] Init crashed:", err);
        useVideoRoomStore
          .getState()
          .setError(err?.message || "Call initialization failed", "init_crash");
      }
    };

    initCall();

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CallScreen
        recipientName={recipientUsername || "Unknown"}
        recipientAvatar={recipientAvatar}
        isGroupCall={isGroupCall}
        onOpenSettings={openSettings}
      />
    </View>
  );
}
