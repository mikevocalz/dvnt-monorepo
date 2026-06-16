// ============================================================
// Custom Slider with Rounded Square Thumb
// ============================================================
// Drop-in replacement for @react-native-community/slider
// with a rounded-square thumb instead of a circle.
// Uses React Native responder system (works inside BottomSheet).
// ============================================================

import React, { useRef, useCallback } from "react";
import { View, LayoutChangeEvent } from "react-native";

interface RoundedSliderProps {
  value: number;
  minimumValue: number;
  maximumValue: number;
  onValueChange: (value: number) => void;
  minimumTrackTintColor?: string;
  maximumTrackTintColor?: string;
  style?: any;
}

const THUMB_SIZE = 22;
const THUMB_RADIUS = 6;
const TRACK_HEIGHT = 3;

export const RoundedSlider: React.FC<RoundedSliderProps> = ({
  value,
  minimumValue,
  maximumValue,
  onValueChange,
  minimumTrackTintColor = "#0095F6",
  maximumTrackTintColor = "#2a2a2a",
  style,
}) => {
  const trackWidth = useRef(0);

  const percent = Math.max(
    0,
    Math.min(1, (value - minimumValue) / (maximumValue - minimumValue)),
  );

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    trackWidth.current = e.nativeEvent.layout.width;
  }, []);

  const resolveValue = useCallback(
    (locationX: number) => {
      if (trackWidth.current <= 0) return;
      const fraction = Math.max(
        0,
        Math.min(1, locationX / trackWidth.current),
      );
      const newVal = Math.round(
        minimumValue + fraction * (maximumValue - minimumValue),
      );
      onValueChange(newVal);
    },
    [minimumValue, maximumValue, onValueChange],
  );

  return (
    <View
      style={[{ height: 40, justifyContent: "center" }, style]}
      onLayout={handleLayout}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(e) => resolveValue(e.nativeEvent.locationX)}
      onResponderMove={(e) => resolveValue(e.nativeEvent.locationX)}
    >
      {/* Track background */}
      <View
        style={{
          height: TRACK_HEIGHT,
          backgroundColor: maximumTrackTintColor,
          borderRadius: TRACK_HEIGHT / 2,
        }}
      >
        {/* Filled track */}
        <View
          style={{
            width: `${percent * 100}%`,
            height: "100%",
            backgroundColor: minimumTrackTintColor,
            borderRadius: TRACK_HEIGHT / 2,
          }}
        />
      </View>

      {/* Rounded square thumb */}
      <View
        style={{
          position: "absolute",
          left: `${percent * 100}%`,
          marginLeft: -THUMB_SIZE / 2,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: THUMB_RADIUS,
          backgroundColor: "#FFFFFF",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 3,
          elevation: 4,
        }}
      />
    </View>
  );
};
