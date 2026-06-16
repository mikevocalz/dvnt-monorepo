// ============================================================
// useElementTransform — Bridge between Zustand store and Skia rendering
// ============================================================
// Creates Reanimated shared values for an element's transform,
// registers them in the module-level registry so gesture overlays
// can write to them, and returns a Skia-compatible derived transform.
// ============================================================

import { useEffect, useRef } from "react";
import {
  useSharedValue,
  useDerivedValue,
  withSpring,
} from "react-native-reanimated";
import { Transform } from "../types";
import { liveTransformRegistry } from "../components/gestures/shared-element-transforms";

export function useElementTransform(elementId: string, transform: Transform) {
  // Start at 0.65× and spring up to the target scale on first mount.
  // Gives a satisfying "pop" when a sticker drops onto the canvas —
  // the premium polish complaint was that adds felt flat.
  const isFirstMount = useRef(true);
  const translateX = useSharedValue(transform.translateX);
  const translateY = useSharedValue(transform.translateY);
  const scale = useSharedValue(
    isFirstMount.current ? transform.scale * 0.65 : transform.scale,
  );
  const rotation = useSharedValue(transform.rotation);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      scale.value = withSpring(transform.scale, {
        damping: 14,
        stiffness: 220,
        mass: 0.6,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync from Zustand store when transform changes externally (undo/redo, gesture end commit).
  // Skip the very first sync so the entrance spring on `scale` isn't
  // immediately overwritten by the same value coming back from Zustand.
  const initialSyncSkipped = useRef(false);
  useEffect(() => {
    if (!initialSyncSkipped.current) {
      initialSyncSkipped.current = true;
      // Still sync translate / rotation — the entrance only animates scale.
      translateX.value = transform.translateX;
      translateY.value = transform.translateY;
      rotation.value = transform.rotation;
      return;
    }
    translateX.value = transform.translateX;
    translateY.value = transform.translateY;
    scale.value = transform.scale;
    rotation.value = transform.rotation;
  }, [
    transform.translateX,
    transform.translateY,
    transform.scale,
    transform.rotation,
  ]);

  // Register SYNCHRONOUSLY so gesture overlays can read shared values
  // during the same render cycle. useEffect runs too late — overlays
  // read the registry during their render and get undefined, falling
  // back to disconnected shared values that Skia never reads.
  liveTransformRegistry.set(elementId, {
    translateX,
    translateY,
    scale,
    rotation,
  });

  // Cleanup on unmount only
  useEffect(() => {
    return () => {
      liveTransformRegistry.delete(elementId);
    };
  }, [elementId]);

  // Skia-compatible transform array driven by shared values (60fps gestures)
  const skiaTransform = useDerivedValue(() => {
    return [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { rotate: (rotation.value * Math.PI) / 180 },
      { scale: scale.value },
    ];
  });

  // Static transform from props — guaranteed to work without Reanimated integration.
  // Re-renders on Zustand store changes (gesture end, undo/redo).
  const staticTransform = [
    { translateX: transform.translateX } as const,
    { translateY: transform.translateY } as const,
    { rotate: (transform.rotation * Math.PI) / 180 } as const,
    { scale: transform.scale } as const,
  ];

  return {
    skiaTransform,
    staticTransform,
    translateX,
    translateY,
    scale,
    rotation,
  };
}
