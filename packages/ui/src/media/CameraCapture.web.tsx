"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { View, Pressable, Text } from "react-native";
import type { CameraType } from "expo-camera";

// Keep in sync with CameraCapture.tsx — the .web fork shadows that module on
// web, so the type cannot be imported from it.
export interface CameraCaptureProps {
  /** Called with the captured photo URI (data URL on web, file URI on native). */
  onCapture: (uri: string) => void;
  /** Front/back. Default "back". */
  facing?: CameraType;
  /** Optional cancel affordance. */
  onCancel?: () => void;
}

/**
 * Web fork of CameraCapture. expo-camera's web CameraView opens getUserMedia —
 * the OS indicator lights up — but its internal <video> never paints on mobile
 * browsers (no playsInline handling, exact facingMode constraints), leaving the
 * reported black screen. This implementation owns the video element and the
 * canvas capture directly; native keeps expo-camera.
 */
export function CameraCapture({ onCapture, facing = "back", onCancel }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setError(null);

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("This browser cannot open the camera.");
        return;
      }
      try {
        // `ideal` not `exact`: an exact back-camera constraint fails outright on
        // devices/browsers that report a single front camera.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing === "back" ? "environment" : "user" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // iOS Safari/Chrome only paint camera video inline with both flags,
          // and play() must be called explicitly after srcObject.
          video.muted = true;
          video.playsInline = true;
          video.autoplay = true;
          await video.play().catch(() => {});
        }
        if (!cancelled) setReady(true);
      } catch (e) {
        if (cancelled) return;
        const name = (e as DOMException)?.name;
        setError(
          name === "NotAllowedError"
            ? "Camera access was denied. Allow it in the browser bar, then reopen."
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "No camera found on this device."
              : "Camera could not be started.",
        );
      }
    };
    start();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const shoot = useCallback(() => {
    const video = videoRef.current;
    if (busy || !video || !ready || !video.videoWidth) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no ctx");
      // Mirror the selfie so the photo matches the preview the user framed.
      if (facing === "front") {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, 0, 0);
      onCapture(canvas.toDataURL("image/jpeg", 0.9));
    } catch {
      setError("Couldn't take the photo. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, ready, facing, onCapture]);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      {/* RNW passes style objects through to the DOM; the raw element owns the
          stream because expo-camera's wrapper is what failed. */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: facing === "front" ? "scaleX(-1)" : undefined,
          background: "#000",
        }}
      />

      {!ready && !error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "rgba(255,255,255,0.6)" }}>Starting camera…</Text>
        </View>
      ) : null}

      {error ? (
        <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", padding: 24 }}>
          <Text style={{ color: "#fff", textAlign: "center" }}>{error}</Text>
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
          disabled={busy || !ready}
          accessibilityLabel="Take photo"
          style={{ width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.25)", opacity: busy || !ready ? 0.6 : 1 }}
        />
      </View>
    </View>
  );
}
