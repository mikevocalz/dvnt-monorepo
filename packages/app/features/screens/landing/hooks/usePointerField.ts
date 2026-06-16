/**
 * Pointer/touch position → shared-value uniforms for the ambient paint-light
 * field. Normalized 0..1 in both axes, smoothed toward the target each frame so
 * the light "follows" rather than snaps. Never writes React state per frame.
 *
 * Web: a passive pointermove listener on window.
 * Native: a Gesture.Pan/hover handler is attached by the consumer via `onMove`.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import {
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

export interface PointerField {
  /** Smoothed normalized pointer position (0..1). */
  x: SharedValue<number>;
  y: SharedValue<number>;
  /** Call from a native gesture handler with normalized coords. */
  onMove: (nx: number, ny: number) => void;
}

export function usePointerField(): PointerField {
  // Target (raw) and smoothed values; the field eases toward the target.
  const tx = useSharedValue(0.5);
  const ty = useSharedValue(0.4);

  const x = useDerivedValue(() => withTiming(tx.value, { duration: 600 }), [tx]);
  const y = useDerivedValue(() => withTiming(ty.value, { duration: 600 }), [ty]);

  const onMove = (nx: number, ny: number) => {
    "worklet";
    tx.value = Math.min(1, Math.max(0, nx));
    ty.value = Math.min(1, Math.max(0, ny));
  };

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const handler = (e: PointerEvent) => {
      tx.value = e.clientX / window.innerWidth;
      ty.value = e.clientY / window.innerHeight;
    };
    window.addEventListener("pointermove", handler, { passive: true });
    return () => window.removeEventListener("pointermove", handler);
  }, [tx, ty]);

  return { x, y, onMove };
}
