/**
 * ImageCropView — Instagram-level pinch/drag/zoom crop component.
 *
 * Renders an image behind a fixed crop frame.
 * User pinch-zooms and pans to position the image.
 * Grid lines for rule-of-thirds composition.
 * Focal-point-aware pinch (zoom centers on fingers).
 *
 * Extended: supports rotate90, straighten, flipX as visual transforms.
 * Exposes shared value refs via onViewRef for export-time readback.
 */

import React, { useMemo, useEffect } from "react";
import { View, StyleSheet } from "react-native";
import { Image } from "expo-image";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { CROP_ASPECT_RATIO, type CropState } from "./crop-utils";
import type { Rotate90 } from "./edit-state";
import { getRotatedDimensions, getStraightenedDimensions } from "./crop-math";

const SPRING_CONFIG = { damping: 20, stiffness: 200, mass: 0.8 };
const MAX_ZOOM_FACTOR = 5;

export interface ViewRefs {
  scale: { value: number };
  translateX: { value: number };
  translateY: { value: number };
}

interface ImageCropViewProps {
  uri: string;
  imageWidth: number;
  imageHeight: number;
  frameWidth: number;
  aspectRatio?: number;
  initialState?: CropState;
  onCropChange?: (state: CropState) => void;
  rotate90?: Rotate90;
  straighten?: number;
  flipX?: boolean;
  onViewRef?: (refs: ViewRefs) => void;
}

export function ImageCropView({
  uri,
  imageWidth,
  imageHeight,
  frameWidth,
  aspectRatio = CROP_ASPECT_RATIO,
  initialState,
  onCropChange,
  rotate90 = 0,
  straighten = 0,
  flipX = false,
  onViewRef,
}: ImageCropViewProps) {
  const frameHeight = Math.round(frameWidth * aspectRatio);

  // Guard: invalid dimensions would cause Infinity/NaN in gesture math → native crash
  if (!imageWidth || !imageHeight || !frameWidth || !frameHeight) {
    return (
      <View
        style={[
          styles.container,
          { width: frameWidth || 300, height: frameHeight || 375 },
        ]}
      >
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          <Image
            source={{ uri }}
            style={{ width: "80%", height: "80%" }}
            contentFit="contain"
          />
        </View>
      </View>
    );
  }

  // Compute effective image dimensions after rotate + straighten
  const rotatedDims = useMemo(
    () => getRotatedDimensions(imageWidth, imageHeight, rotate90),
    [imageWidth, imageHeight, rotate90],
  );
  const effectiveDims = useMemo(
    () => getStraightenedDimensions(rotatedDims.w, rotatedDims.h, straighten),
    [rotatedDims.w, rotatedDims.h, straighten],
  );

  // Use effective dimensions for scale/pan math so the crop frame
  // sees the image as it will appear after rotation
  const effW = effectiveDims.w;
  const effH = effectiveDims.h;

  const minScale = useMemo(
    () => Math.max(frameWidth / effW, frameHeight / effH),
    [effW, effH, frameWidth, frameHeight],
  );
  const maxScale = minScale * MAX_ZOOM_FACTOR;

  // Gesture state (shared values for 60fps animation)
  const scale = useSharedValue(initialState?.scale ?? minScale);
  const translateX = useSharedValue(initialState?.translateX ?? 0);
  const translateY = useSharedValue(initialState?.translateY ?? 0);

  // Saved state at gesture start
  const savedScale = useSharedValue(initialState?.scale ?? minScale);
  const savedTranslateX = useSharedValue(initialState?.translateX ?? 0);
  const savedTranslateY = useSharedValue(initialState?.translateY ?? 0);

  // Expose shared values to parent for export-time readback
  useEffect(() => {
    onViewRef?.({ scale, translateX, translateY });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const notifyCropChange = (s: number, tx: number, ty: number) => {
    onCropChange?.({ scale: s, translateX: tx, translateY: ty });
  };

  // Clamp to valid bounds with spring animation
  // CRITICAL: All math is inlined — worklets CANNOT call imported JS functions
  const clampAndNotify = () => {
    "worklet";
    const cs = Math.max(minScale, Math.min(maxScale, scale.value));
    // Inline clampPan: ensure image always covers the frame
    // Uses effective dimensions (post-rotate) for correct clamping
    const dw = effW * cs;
    const dh = effH * cs;
    const maxPanX = Math.max(0, (dw - frameWidth) / 2);
    const maxPanY = Math.max(0, (dh - frameHeight) / 2);
    const clampedX = Math.min(maxPanX, Math.max(-maxPanX, translateX.value));
    const clampedY = Math.min(maxPanY, Math.max(-maxPanY, translateY.value));

    scale.value = withSpring(cs, SPRING_CONFIG);
    translateX.value = withSpring(clampedX, SPRING_CONFIG);
    translateY.value = withSpring(clampedY, SPRING_CONFIG);
    runOnJS(notifyCropChange)(cs, clampedX, clampedY);
  };

  // Pan gesture — delta-based for simultaneous compat
  const panGesture = Gesture.Pan()
    .minDistance(4)
    .onStart(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      clampAndNotify();
    });

  // Pinch gesture — focal-point-aware zoom
  const pinchGesture = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      // Allow rubber-band below minScale (snaps back on end)
      const newScale = Math.min(
        maxScale,
        Math.max(minScale * 0.5, savedScale.value * e.scale),
      );
      scale.value = newScale;

      // Focal-point-aware: keep point under fingers stationary
      const fx = e.focalX - frameWidth / 2;
      const fy = e.focalY - frameHeight / 2;
      const ds = newScale / savedScale.value;
      translateX.value = fx + ds * (savedTranslateX.value - fx);
      translateY.value = fy + ds * (savedTranslateY.value - fy);
    })
    .onEnd(() => {
      clampAndNotify();
    });

  // Double-tap to reset
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      scale.value = withSpring(minScale, SPRING_CONFIG);
      translateX.value = withSpring(0, SPRING_CONFIG);
      translateY.value = withSpring(0, SPRING_CONFIG);
      runOnJS(notifyCropChange)(minScale, 0, 0);
    });

  const composed = Gesture.Exclusive(
    doubleTap,
    Gesture.Simultaneous(panGesture, pinchGesture),
  );

  // Total visual rotation for preview (rotate90 + straighten)
  const totalRotationDeg = rotate90 + straighten;

  // Animated image style — centered in frame with pan/zoom offset
  // Applies rotate + straighten + flip as visual transforms
  const animatedImageStyle = useAnimatedStyle(() => {
    const dw = effW * scale.value;
    const dh = effH * scale.value;
    return {
      width: imageWidth * scale.value,
      height: imageHeight * scale.value,
      transform: [
        { translateX: (frameWidth - dw) / 2 + translateX.value },
        { translateY: (frameHeight - dh) / 2 + translateY.value },
        // Center the raw image before rotating
        { translateX: (dw - imageWidth * scale.value) / 2 },
        { translateY: (dh - imageHeight * scale.value) / 2 },
        { rotate: `${totalRotationDeg}deg` },
        { scaleX: flipX ? -1 : 1 },
      ],
    };
  });

  return (
    <View
      style={[styles.container, { width: frameWidth, height: frameHeight }]}
    >
      <GestureDetector gesture={composed}>
        <View
          style={[styles.frame, { width: frameWidth, height: frameHeight }]}
        >
          <Animated.View style={[styles.imageWrap, animatedImageStyle]}>
            <Image
              source={{ uri }}
              style={StyleSheet.absoluteFill}
              contentFit="fill"
            />
          </Animated.View>
        </View>
      </GestureDetector>

      {/* Rule-of-thirds grid */}
      <View
        style={[styles.gridOverlay, { width: frameWidth, height: frameHeight }]}
        pointerEvents="none"
      >
        <View style={[styles.gridH, { top: frameHeight / 3 }]} />
        <View style={[styles.gridH, { top: (frameHeight / 3) * 2 }]} />
        <View style={[styles.gridV, { left: frameWidth / 3 }]} />
        <View style={[styles.gridV, { left: (frameWidth / 3) * 2 }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: "#000",
  },
  frame: {
    overflow: "hidden",
  },
  imageWrap: {
    position: "absolute",
  },
  gridOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
  },
  gridH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  gridV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.25)",
  },
});
