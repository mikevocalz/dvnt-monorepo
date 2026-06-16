"use client";

import { useRef, useState } from "react";
import { View, Pressable } from "react-native";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { Text } from "react-native";

export interface CameraCaptureProps {
  /** Called with the captured photo URI (data URL on web, file URI on native). */
  onCapture: (uri: string) => void;
  /** Front/back. Default "back". */
  facing?: CameraType;
  /** Optional cancel affordance. */
  onCancel?: () => void;
}

/**
 * Universal camera capture. `expo-camera` works on web (getUserMedia) and native
 * with one API — per the project decision to use expo-camera over react-webcam.
 * Replaces vision-camera on web. Renders a permission gate, the live preview,
 * and a shutter that returns a photo URI.
 */
export function CameraCapture({ onCapture, facing = "back", onCancel }: CameraCaptureProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const ref = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);

  if (!permission) return <View style={{ flex: 1, backgroundColor: "#000" }} />;

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, backgroundColor: "#000", padding: 24 }}>
        <Text style={{ color: "#fff", textAlign: "center" }}>Camera access is needed to take a photo.</Text>
        <Pressable onPress={requestPermission} style={{ paddingHorizontal: 20, height: 44, borderRadius: 14, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Grant access</Text>
        </Pressable>
      </View>
    );
  }

  const shoot = async () => {
    if (busy || !ref.current) return;
    setBusy(true);
    try {
      const photo = await ref.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) onCapture(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={ref} style={{ flex: 1 }} facing={facing} />
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 28 }}>
        {onCancel ? (
          <Pressable onPress={onCancel} style={{ position: "absolute", left: 24, width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.15)", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff" }}>Cancel</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={shoot}
          disabled={busy}
          style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.25)", opacity: busy ? 0.6 : 1 }}
        />
      </View>
    </View>
  );
}
