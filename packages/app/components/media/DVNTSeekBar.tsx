/**
 * DVNTSeekBar
 *
 * Premium gradient seek bar — always visible, 4px from bottom of media frame.
 * Colors: #3FDCFF → #8A40CF → #FF5BFC
 * Uses PanResponder (no extra deps). isDragging stored in ref (no re-render churn).
 */
import { View, PanResponder, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRef, useCallback, useEffect } from "react";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

interface DVNTSeekBarProps {
  currentTime: number;
  duration: number;
  onSeek?: (time: number) => void;
  onSeekEnd?: () => void;
  barWidth?: number;
  /** If false/undefined, bar is still rendered but at 0 progress (no flicker) */
  visible?: boolean;
}

export function DVNTSeekBar({
  currentTime,
  duration,
  onSeek,
  onSeekEnd,
  barWidth,
  visible = true,
}: DVNTSeekBarProps) {
  const resolvedWidth = barWidth ?? SCREEN_WIDTH - 32;
  const isDraggingRef = useRef(false);
  const localProgressRef = useRef(0);
  const barXRef = useRef(0);
  const progressAnimated = useSharedValue(0);
  const barViewRef = useRef<View>(null);

  // Update animated progress from prop when not dragging
  useEffect(() => {
    if (!isDraggingRef.current && duration > 0) {
      const p = Math.max(0, Math.min(1, currentTime / duration));
      localProgressRef.current = p;
      progressAnimated.value = withTiming(p, { duration: 100 });
    }
  }, [currentTime, duration, progressAnimated]);

  const handleSeek = useCallback(
    (locationX: number) => {
      if (!onSeek) return;
      const p = Math.max(0, Math.min(1, locationX / resolvedWidth));
      localProgressRef.current = p;
      progressAnimated.value = p;
      onSeek(p * (duration || 1));
    },
    [resolvedWidth, duration, onSeek, progressAnimated],
  );

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => {
        isDraggingRef.current = true;
        handleSeek(evt.nativeEvent.locationX);
      },
      onPanResponderMove: (evt, state) => {
        handleSeek(state.moveX - barXRef.current);
      },
      onPanResponderRelease: () => {
        isDraggingRef.current = false;
        onSeekEnd?.();
      },
      onPanResponderTerminate: () => {
        isDraggingRef.current = false;
        onSeekEnd?.();
      },
    }),
  ).current;

  const fillStyle = useAnimatedStyle(() => ({
    width: `${progressAnimated.value * 100}%` as any,
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    left: progressAnimated.value * resolvedWidth - 6,
  }));

  return (
    <View
      style={{
        position: "absolute",
        bottom: 4,
        left: 16,
        right: 16,
        height: 20,
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <View
        ref={barViewRef}
        onLayout={() => {
          barViewRef.current?.measureInWindow((x) => {
            barXRef.current = x;
          });
        }}
        style={{
          width: resolvedWidth,
          height: 9,
          backgroundColor: "rgba(255,255,255,0.20)",
          borderRadius: 3,
          overflow: "visible",
        }}
        {...panResponder.panHandlers}
      >
        {/* Gradient fill */}
        <Animated.View
          style={[
            { height: "100%", borderRadius: 3, overflow: "hidden" },
            fillStyle,
          ]}
        >
          <LinearGradient
            colors={["#3FDCFF", "#8A40CF", "#FF5BFC"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>

      {/* Thumb */}
      <Animated.View
        style={[
          {
            position: "absolute",
            top: 4,
            width: 12,
            height: 12,
            borderRadius: 3,
            backgroundColor: "#FF5BFC",
            shadowColor: "#FF5BFC",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.9,
            shadowRadius: 4,
            elevation: 4,
          },
          thumbStyle,
        ]}
        pointerEvents="none"
      />
    </View>
  );
}
