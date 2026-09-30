"use client";

import { useEffect, useRef, useState } from "react";
import { View, Pressable , Text } from "react-native";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";

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
  const [error, setError] = useState<string | null>(null);
  const autoRequested = useRef(false);

  // On web the permissions query can stall or throw (Safari/Firefox lack the
  // `camera` descriptor), leaving `permission` null forever — which rendered a
  // dead black screen. Ask once instead; the web request path probes
  // getUserMedia directly and still prompts the user.
  useEffect(() => {
    if (permission === null && !autoRequested.current) {
      autoRequested.current = true;
      requestPermission().catch(() => setError("Camera access could not be started."));
    }
  }, [permission, requestPermission]);

  if (!permission) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#000", padding: 24 }}>
        <Text style={{ color: "rgba(255,255,255,0.6)" }}>{error ?? "Starting camera…"}</Text>
      </View>
    );
  }

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
    setError(null);
    try {
      const photo = await ref.current.takePictureAsync({ quality: 0.9 });
      if (photo?.uri) onCapture(photo.uri);
    } catch {
      setError("Couldn't take the photo. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <CameraView ref={ref} style={{ flex: 1 }} facing={facing} />
      {error ? (
        <View style={{ position: "absolute", left: 0, right: 0, bottom: 140, alignItems: "center" }}>
          <Text style={{ color: "#fff", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}>{error}</Text>
        </View>
      ) : null}
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
