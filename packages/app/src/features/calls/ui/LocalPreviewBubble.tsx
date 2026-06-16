/**
 * LocalPreviewBubble — Small rounded rectangle showing local camera feed.
 *
 * Positioned top-right by default. Draggable via PanResponder.
 * Only renders when there is an active local video stream.
 */

import { useRef } from "react";
import {
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";

const BUBBLE_W = 110;
const BUBBLE_H = 150;
const MARGIN = 12;
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export interface LocalPreviewBubbleProps {
  stream: MediaStream;
}

export function LocalPreviewBubble({ stream }: LocalPreviewBubbleProps) {
  const insets = useSafeAreaInsets();
  const pan = useRef(
    new Animated.ValueXY({
      x: SCREEN_W - BUBBLE_W - MARGIN,
      y: insets.top + MARGIN,
    }),
  ).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          x: (pan.x as any)._value,
          y: (pan.y as any)._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // Snap to nearest horizontal edge
        const currentX = (pan.x as any)._value;
        const snapX =
          currentX < SCREEN_W / 2 ? MARGIN : SCREEN_W - BUBBLE_W - MARGIN;
        // Clamp Y
        const currentY = (pan.y as any)._value;
        const clampedY = Math.max(
          insets.top + MARGIN,
          Math.min(currentY, SCREEN_H - BUBBLE_H - insets.bottom - 100),
        );
        Animated.spring(pan, {
          toValue: { x: snapX, y: clampedY },
          useNativeDriver: false,
          friction: 7,
        }).start();
      },
    }),
  ).current;

  return (
    <Animated.View
      style={[
        styles.bubble,
        { transform: [{ translateX: pan.x }, { translateY: pan.y }] },
      ]}
      {...panResponder.panHandlers}
    >
      <RTCView
        mediaStream={stream}
        style={StyleSheet.absoluteFill}
        objectFit="cover"
        mirror={true}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    width: BUBBLE_W,
    height: BUBBLE_H,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    zIndex: 10,
  },
});
