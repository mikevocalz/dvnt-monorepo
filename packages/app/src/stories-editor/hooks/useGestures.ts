// ============================================================
// Instagram Stories Editor - Gesture Handling Hook
// ============================================================
//
// Handles multi-touch gestures for canvas elements:
// - Single finger drag (translate)
// - Two finger pinch (scale)
// - Two finger rotate (rotation)
// - Double tap (select/edit)
// - Long press (reorder/delete)
// ============================================================

import { useCallback, useRef } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  SharedValue,
} from "react-native-reanimated";
import { Transform, Position, CanvasElement } from "../types";
import { SPRING_CONFIG } from "../constants";
import { clamp } from "../utils/helpers";

interface UseElementGesturesOptions {
  element: CanvasElement;
  onUpdate: (id: string, updates: Partial<CanvasElement>) => void;
  onSelect: (id: string | null) => void;
  onDelete?: (id: string) => void;
  onDoubleTap?: (id: string) => void;
  isSelected: boolean;
  canvasWidth: number;
  canvasHeight: number;
  enabled: boolean;
}

export const useElementGestures = ({
  element,
  onUpdate,
  onSelect,
  onDelete,
  onDoubleTap,
  isSelected,
  canvasWidth,
  canvasHeight,
  enabled,
}: UseElementGesturesOptions) => {
  // Shared values for smooth animation
  const translateX = useSharedValue(element.transform.translateX);
  const translateY = useSharedValue(element.transform.translateY);
  const scale = useSharedValue(element.transform.scale);
  const rotation = useSharedValue(element.transform.rotation);
  const opacity = useSharedValue(element.opacity);

  // Saved values for gesture start
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedRotation = useSharedValue(0);

  // Track if element is being dragged to trash
  const isOverTrash = useSharedValue(false);

  // ---- Update callback wrappers ----

  const handleUpdate = useCallback(
    (transform: Partial<Transform>) => {
      onUpdate(element.id, {
        transform: { ...element.transform, ...transform },
      });
    },
    [element.id, element.transform, onUpdate],
  );

  const handleSelect = useCallback(() => {
    onSelect(element.id);
  }, [element.id, onSelect]);

  const handleDeselect = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

  const handleDoubleTap = useCallback(() => {
    onDoubleTap?.(element.id);
  }, [element.id, onDoubleTap]);

  const handleDelete = useCallback(() => {
    onDelete?.(element.id);
  }, [element.id, onDelete]);

  // ---- Gestures ----

  // Pan gesture (drag)
  const panGesture = Gesture.Pan()
    .enabled(enabled)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      runOnJS(handleSelect)();
    })
    .onUpdate((event) => {
      translateX.value = savedTranslateX.value + event.translationX;
      translateY.value = savedTranslateY.value + event.translationY;

      // Check if over trash zone (bottom center of screen)
      const isNearTrash =
        translateY.value > canvasHeight * 0.85 &&
        Math.abs(translateX.value - canvasWidth / 2) < canvasWidth * 0.2;

      if (isNearTrash !== isOverTrash.value) {
        isOverTrash.value = isNearTrash;
        if (isNearTrash) {
          scale.value = withSpring(0.6, SPRING_CONFIG);
          opacity.value = withSpring(0.5, SPRING_CONFIG);
        } else {
          scale.value = withSpring(
            savedScale.value || element.transform.scale,
            SPRING_CONFIG,
          );
          opacity.value = withSpring(1, SPRING_CONFIG);
        }
      }
    })
    .onEnd(() => {
      if (isOverTrash.value) {
        // Delete element with animation
        scale.value = withSpring(0, SPRING_CONFIG);
        opacity.value = withSpring(0, SPRING_CONFIG);
        runOnJS(handleDelete)();
      } else {
        // Save final position
        runOnJS(handleUpdate)({
          translateX: translateX.value,
          translateY: translateY.value,
        });
      }
      isOverTrash.value = false;
    });

  // Pinch gesture (scale)
  const pinchGesture = Gesture.Pinch()
    .enabled(enabled)
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((event) => {
      scale.value = clamp(savedScale.value * event.scale, 0.2, 5);
    })
    .onEnd(() => {
      runOnJS(handleUpdate)({ scale: scale.value });
    });

  // Rotation gesture
  const rotationGesture = Gesture.Rotation()
    .enabled(enabled)
    .onStart(() => {
      savedRotation.value = rotation.value;
    })
    .onUpdate((event) => {
      rotation.value = savedRotation.value + (event.rotation * 180) / Math.PI;
    })
    .onEnd(() => {
      // Snap to 0, 90, 180, 270 if close
      const snappedRotation = snapRotation(rotation.value);
      if (Math.abs(snappedRotation - rotation.value) < 5) {
        rotation.value = withSpring(snappedRotation, SPRING_CONFIG);
        runOnJS(handleUpdate)({ rotation: snappedRotation });
      } else {
        runOnJS(handleUpdate)({ rotation: rotation.value });
      }
    });

  // Tap gesture (select)
  const tapGesture = Gesture.Tap()
    .enabled(enabled)
    .onEnd(() => {
      runOnJS(handleSelect)();
    });

  // Double tap gesture (edit mode)
  const doubleTapGesture = Gesture.Tap()
    .enabled(enabled)
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(handleDoubleTap)();
    });

  // Long press gesture (context menu)
  const longPressGesture = Gesture.LongPress()
    .enabled(enabled)
    .minDuration(500)
    .onStart(() => {
      // Haptic feedback would go here
      runOnJS(handleSelect)();
    });

  // Compose all gestures
  const composedGesture = Gesture.Simultaneous(
    panGesture,
    pinchGesture,
    rotationGesture,
  );

  const fullGesture = Gesture.Exclusive(
    doubleTapGesture,
    Gesture.Simultaneous(composedGesture, longPressGesture),
    tapGesture,
  );

  // ---- Animated Style ----

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value - canvasWidth / 2 },
      { translateY: translateY.value - canvasHeight / 2 },
      { scale: scale.value },
      { rotate: `${rotation.value}deg` },
    ],
    opacity: opacity.value,
    position: "absolute" as const,
    left: canvasWidth / 2,
    top: canvasHeight / 2,
  }));

  // ---- Sync from props ----
  // Call this when the element transform is updated externally
  const syncFromProps = useCallback(() => {
    translateX.value = element.transform.translateX;
    translateY.value = element.transform.translateY;
    scale.value = element.transform.scale;
    rotation.value = element.transform.rotation;
    opacity.value = element.opacity;
  }, [element.transform, element.opacity]);

  return {
    gesture: fullGesture,
    animatedStyle,
    syncFromProps,
    isOverTrash,
    // Expose shared values for external animation
    sharedValues: {
      translateX,
      translateY,
      scale,
      rotation,
      opacity,
    },
  };
};

// ---- Drawing Gesture Hook ----

interface UseDrawingGesturesOptions {
  isActive: boolean;
  onPathStart: (point: Position) => void;
  onPathUpdate: (point: Position) => void;
  onPathEnd: () => void;
  canvasScale: number;
}

export const useDrawingGestures = ({
  isActive,
  onPathStart,
  onPathUpdate,
  onPathEnd,
  canvasScale,
}: UseDrawingGesturesOptions) => {
  const isDrawing = useSharedValue(false);

  // Wrap callbacks so they receive raw coords and build points on JS thread
  const jsPathStart = useCallback(
    (x: number, y: number) => {
      onPathStart({ x: x / canvasScale, y: y / canvasScale });
    },
    [onPathStart, canvasScale],
  );

  const jsPathUpdate = useCallback(
    (x: number, y: number) => {
      onPathUpdate({ x: x / canvasScale, y: y / canvasScale });
    },
    [onPathUpdate, canvasScale],
  );

  const panGesture = Gesture.Pan()
    .enabled(isActive)
    .minDistance(0)
    .onStart((event) => {
      "worklet";
      isDrawing.value = true;
      runOnJS(jsPathStart)(event.x, event.y);
    })
    .onUpdate((event) => {
      "worklet";
      if (!isDrawing.value) return;
      runOnJS(jsPathUpdate)(event.x, event.y);
    })
    .onEnd(() => {
      "worklet";
      isDrawing.value = false;
      runOnJS(onPathEnd)();
    });

  return { gesture: panGesture };
};

// ---- Helpers ----

const snapRotation = (rotation: number): number => {
  const normalized = ((rotation % 360) + 360) % 360;
  const snapAngles = [0, 90, 180, 270, 360];
  let closest = snapAngles[0];
  let minDiff = Math.abs(normalized - snapAngles[0]);

  for (const angle of snapAngles) {
    const diff = Math.abs(normalized - angle);
    if (diff < minDiff) {
      minDiff = diff;
      closest = angle;
    }
  }

  return closest === 360 ? 0 : closest;
};
