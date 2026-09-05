/**
 * useMediaPermissions — Strict Permission State Machine
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  INVARIANT: NO ROOM JOIN OCCURS UNTIL:                             ║
 * ║    - Camera permission = granted (for video calls)                 ║
 * ║    - Microphone permission = granted (always)                      ║
 * ║                                                                    ║
 * ║  Permission gating is explicit and awaited.                        ║
 * ║  UI MUST block progression until resolved.                         ║
 * ║  Permission denial MUST show UI feedback.                          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { useCallback } from "react";
import {
  useCameraPermission,
  useMicrophonePermission,
} from "react-native-vision-camera";
import { Linking, Platform } from "react-native";
import { useVideoRoomStore } from "../stores/video-room-store";
import type { CallType, PermissionState } from "../stores/video-room-store";

export interface MediaPermissionResult {
  camera: PermissionState;
  mic: PermissionState;
  allGranted: boolean;
}

export function useMediaPermissions() {
  const { hasPermission: hasCamPerm, requestPermission: reqCamPerm } =
    useCameraPermission();
  const { hasPermission: hasMicPerm, requestPermission: reqMicPerm } =
    useMicrophonePermission();

  const setCameraPermission = useVideoRoomStore((s) => s.setCameraPermission);
  const setMicPermission = useVideoRoomStore((s) => s.setMicPermission);
  const setCallPhase = useVideoRoomStore((s) => s.setCallPhase);
  const cameraPermission = useVideoRoomStore((s) => s.cameraPermission);
  const micPermission = useVideoRoomStore((s) => s.micPermission);

  /**
   * Request all permissions needed for the given call type.
   * Returns true only if ALL required permissions are granted.
   * Updates the Zustand store with permission states.
   * Sets callPhase to "perms_denied" if any permission is denied.
   */
  const requestPermissions = useCallback(
    async (callType: CallType): Promise<boolean> => {
      console.log(
        `[Permissions] Requesting permissions for ${callType} call`,
      );
      setCallPhase("requesting_perms");

      // Always request microphone
      let micGranted = hasMicPerm;
      if (!micGranted) {
        micGranted = await reqMicPerm();
        console.log(`[Permissions] Mic permission: ${micGranted ? "granted" : "DENIED"}`);
      }
      setMicPermission(micGranted ? "granted" : "denied");

      if (!micGranted) {
        console.error("[Permissions] BLOCKED: Microphone permission denied");
        setCallPhase("perms_denied");
        return false;
      }

      // Request camera for video calls
      if (callType === "video") {
        let camGranted = hasCamPerm;
        if (!camGranted) {
          camGranted = await reqCamPerm();
          console.log(`[Permissions] Camera permission: ${camGranted ? "granted" : "DENIED"}`);
        }
        setCameraPermission(camGranted ? "granted" : "denied");

        if (!camGranted) {
          console.error("[Permissions] BLOCKED: Camera permission denied");
          setCallPhase("perms_denied");
          return false;
        }
      } else {
        // Audio-only: camera permission not required
        setCameraPermission(hasCamPerm ? "granted" : "pending");
      }

      console.log("[Permissions] All required permissions granted");
      return true;
    },
    [
      hasCamPerm,
      hasMicPerm,
      reqCamPerm,
      reqMicPerm,
      setCameraPermission,
      setMicPermission,
      setCallPhase,
    ],
  );

  /**
   * Open system settings so user can grant permissions manually.
   */
  const openSettings = useCallback(() => {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
  }, []);

  return {
    cameraPermission,
    micPermission,
    hasCameraPermission: hasCamPerm,
    hasMicPermission: hasMicPerm,
    requestPermissions,
    openSettings,
  };
}
