// ============================================================
// Per-Element Gesture Overlay (wcandillon pattern)
// ============================================================
// Renders an invisible Animated.View on top of the Skia Canvas,
// positioned to match the element's screen-space bounding box.
// Pan/pinch/rotate gestures write directly to Reanimated shared
// values on the UI thread — no runOnJS during gestures.
// On gesture end, the final transform is committed to Zustand.
// ============================================================

import React, { useCallback } from "react";
import { Pressable, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
  FadeIn,
  FadeOut,
  ZoomIn,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { X } from "lucide-react-native";
import type { RenderSurface } from "../../utils/geometry";
import { liveTransformRegistry } from "./shared-element-transforms";

interface ElementGestureOverlayProps {
  elementId: string;
  elementType: string;
  elementWidth: number;
  elementHeight: number;
  surface: RenderSurface;
  isSelected: boolean;
  initialTransform: {
    translateX: number;
    translateY: number;
    scale: number;
    rotation: number;
  };
  onSelect: (id: string | null) => void;
  onTransformEnd: (
    id: string,
    transform: {
      translateX: number;
      translateY: number;
      scale: number;
      rotation: number;
    },
  ) => void;
  onDoubleTap?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export const ElementGestureOverlay: React.FC<ElementGestureOverlayProps> =
  React.memo(
    ({
      elementId,
      elementType,
      elementWidth,
      elementHeight,
      surface,
      isSelected,
      initialTransform,
      onSelect,
      onTransformEnd,
      onDoubleTap,
      onDelete,
    }) => {
      // Get the shared values from the registry (created by useElementTransform in Skia renderer)
      const live = liveTransformRegistry.get(elementId);
      // Fallback shared values seeded from the element's Zustand transform
      // so the overlay starts at the correct position even before the Skia
      // renderer mounts and populates the registry.
      const fallbackX = useSharedValue(initialTransform.translateX);
      const fallbackY = useSharedValue(initialTransform.translateY);
      const fallbackScale = useSharedValue(initialTransform.scale);
      const fallbackRotation = useSharedValue(initialTransform.rotation);

      const tx = live?.translateX ?? fallbackX;
      const ty = live?.translateY ?? fallbackY;
      const sc = live?.scale ?? fallbackScale;
      const rot = live?.rotation ?? fallbackRotation;

      // Gesture anchors (set at gesture start, accumulated during gesture)
      const panAnchorX = useSharedValue(0);
      const panAnchorY = useSharedValue(0);
      const pinchAnchorScale = useSharedValue(1);
      const pinchAnchorX = useSharedValue(0);
      const pinchAnchorY = useSharedValue(0);
      const pinchFocalX = useSharedValue(0);
      const pinchFocalY = useSharedValue(0);
      const rotationAnchorDeg = useSharedValue(0);
      const rotationAnchorX = useSharedValue(0);
      const rotationAnchorY = useSharedValue(0);
      const rotationOriginX = useSharedValue(0);
      const rotationOriginY = useSharedValue(0);
      const selectIfNeeded = useCallback(() => {
        if (!isSelected) onSelect(elementId);
      }, [isSelected, elementId, onSelect]);

      const commitTransform = useCallback(
        (id: string) => {
          // Re-read from the live registry (most up-to-date)
          const current = liveTransformRegistry.get(id);
          if (!current) return;
          onTransformEnd(id, {
            translateX: current.translateX.value,
            translateY: current.translateY.value,
            scale: current.scale.value,
            rotation: current.rotation.value,
          });
        },
        [onTransformEnd],
      );

      // ---- Pan ----
      const pan = Gesture.Pan()
        .onStart(() => {
          "worklet";
          panAnchorX.value = tx.value;
          panAnchorY.value = ty.value;
          runOnJS(selectIfNeeded)();
        })
        .onChange((e) => {
          "worklet";
          // Convert screen-space delta → canvas-space delta
          tx.value = panAnchorX.value + e.translationX / surface.scale;
          ty.value = panAnchorY.value + e.translationY / surface.scale;
        })
        .onEnd(() => {
          "worklet";
          runOnJS(commitTransform)(elementId);
        });

      // ---- Pinch ----
      const pinch = Gesture.Pinch()
        .onStart((e) => {
          "worklet";
          pinchAnchorScale.value = sc.value;
          pinchAnchorX.value = tx.value;
          pinchAnchorY.value = ty.value;
          pinchFocalX.value = (e.focalX - surface.offsetX) / surface.scale;
          pinchFocalY.value = (e.focalY - surface.offsetY) / surface.scale;
          runOnJS(selectIfNeeded)();
        })
        .onChange((e) => {
          "worklet";
          const nextScale = Math.max(
            0.2,
            Math.min(5, pinchAnchorScale.value * e.scale),
          );
          const ratio = nextScale / Math.max(0.001, pinchAnchorScale.value);

          // Keep the gesture focal point visually pinned, matching Skia's
          // matrix-based sticker sample instead of scaling only from center.
          tx.value =
            pinchFocalX.value -
            (pinchFocalX.value - pinchAnchorX.value) * ratio;
          ty.value =
            pinchFocalY.value -
            (pinchFocalY.value - pinchAnchorY.value) * ratio;
          sc.value = nextScale;
        })
        .onEnd(() => {
          "worklet";
          sc.value = withSpring(sc.value, {
            damping: 18,
            stiffness: 220,
            mass: 0.7,
          });
          runOnJS(commitTransform)(elementId);
        });

      // ---- Rotation ----
      const rotate = Gesture.Rotation()
        .onStart((e) => {
          "worklet";
          rotationAnchorDeg.value = rot.value;
          rotationAnchorX.value = tx.value;
          rotationAnchorY.value = ty.value;
          rotationOriginX.value = (e.anchorX - surface.offsetX) / surface.scale;
          rotationOriginY.value = (e.anchorY - surface.offsetY) / surface.scale;
          runOnJS(selectIfNeeded)();
        })
        .onChange((e) => {
          "worklet";
          const nextRotation =
            rotationAnchorDeg.value + (e.rotation * 180) / Math.PI;
          const cos = Math.cos(e.rotation);
          const sin = Math.sin(e.rotation);
          const dx = rotationAnchorX.value - rotationOriginX.value;
          const dy = rotationAnchorY.value - rotationOriginY.value;

          // Rotate the sticker center around the user's rotation anchor.
          tx.value = rotationOriginX.value + dx * cos - dy * sin;
          ty.value = rotationOriginY.value + dx * sin + dy * cos;
          rot.value = nextRotation;
        })
        .onEnd(() => {
          "worklet";
          const normalized = (((rot.value % 360) + 540) % 360) - 180;
          const snapTargets = [-90, 0, 90, 180, -180];
          let snapped = normalized;
          for (const target of snapTargets) {
            if (Math.abs(normalized - target) <= 3) {
              snapped = target;
              break;
            }
          }
          rot.value = withSpring(snapped, {
            damping: 20,
            stiffness: 240,
            mass: 0.7,
          });
          runOnJS(commitTransform)(elementId);
        });

      // ---- Double tap to edit text ----
      const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          "worklet";
          if (onDoubleTap) {
            runOnJS(onDoubleTap)(elementId);
          }
        });

      const gesture = Gesture.Race(
        doubleTap,
        Gesture.Simultaneous(pan, pinch, rotate),
      );

      // Position the invisible overlay at the element's screen location
      // Use a minimum screen-space size so two-finger pinch is always possible
      const MIN_OVERLAY_PX = 120;
      const animatedStyle = useAnimatedStyle(() => {
        const scaledW = Math.max(
          elementWidth * sc.value * surface.scale,
          MIN_OVERLAY_PX,
        );
        const scaledH = Math.max(
          elementHeight * sc.value * surface.scale,
          MIN_OVERLAY_PX,
        );

        const centerScreenX = tx.value * surface.scale + surface.offsetX;
        const centerScreenY = ty.value * surface.scale + surface.offsetY;

        return {
          position: "absolute" as const,
          left: centerScreenX - scaledW / 2,
          top: centerScreenY - scaledH / 2,
          width: scaledW,
          height: scaledH,
          transform: [{ rotate: `${rot.value}deg` }],
        };
      });

      const handleDeletePress = useCallback(() => {
        if (!onDelete) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onDelete(elementId);
      }, [elementId, onDelete]);

      return (
        <>
          <GestureDetector gesture={gesture}>
            <Animated.View style={animatedStyle} collapsable={false} />
          </GestureDetector>
          {/* Floating delete handle — only when this element is selected.
              Sits at the top-right of the gesture box and follows pan/scale/
              rotate via the same animated style + an offset. Rendered as a
              sibling (not a child) so it doesn't sit inside the rotated
              container, which would make the X tilt with the sticker. */}
          {isSelected && onDelete ? (
            <DeleteHandle
              tx={tx}
              ty={ty}
              sc={sc}
              elementWidth={elementWidth}
              elementHeight={elementHeight}
              surface={surface}
              onPress={handleDeletePress}
            />
          ) : null}
        </>
      );
    },
  );

interface DeleteHandleProps {
  tx: { value: number };
  ty: { value: number };
  sc: { value: number };
  elementWidth: number;
  elementHeight: number;
  surface: RenderSurface;
  onPress: () => void;
}

function DeleteHandle({
  tx,
  ty,
  sc,
  elementWidth,
  elementHeight,
  surface,
  onPress,
}: DeleteHandleProps) {
  const SIZE = 30;
  const animatedStyle = useAnimatedStyle(() => {
    // Mirror the gesture overlay's screen position so the delete X tracks
    // the element while it's being moved/scaled. Use the unrotated box;
    // we DO follow scale so the X stays visually anchored to the corner.
    const scaledW = Math.max(
      elementWidth * (sc as any).value * surface.scale,
      120,
    );
    const scaledH = Math.max(
      elementHeight * (sc as any).value * surface.scale,
      120,
    );
    const centerScreenX = (tx as any).value * surface.scale + surface.offsetX;
    const centerScreenY = (ty as any).value * surface.scale + surface.offsetY;
    return {
      position: "absolute" as const,
      left: centerScreenX + scaledW / 2 - SIZE / 2,
      top: centerScreenY - scaledH / 2 - SIZE / 2,
      width: SIZE,
      height: SIZE,
    };
  });
  return (
    <Animated.View
      style={animatedStyle}
      entering={ZoomIn.duration(180)}
      exiting={FadeOut.duration(120)}
      pointerEvents="box-none"
    >
      <Pressable
        onPress={onPress}
        hitSlop={10}
        style={{
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: "rgba(0,0,0,0.78)",
          borderWidth: 1.5,
          borderColor: "rgba(255,255,255,0.85)",
          alignItems: "center",
          justifyContent: "center",
          shadowColor: "#000",
          shadowOpacity: 0.35,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 6,
        }}
      >
        <X size={16} color="#fff" strokeWidth={2.5} />
      </Pressable>
    </Animated.View>
  );
}

ElementGestureOverlay.displayName = "ElementGestureOverlay";
