// ============================================================
// Right Island Menu — Dynamic Island–style slide-out tool menu
// ============================================================
// Reference: reactnativecomponents.com/components/menus/sticky-right-menu
//
// • Narrow indicator tab flush on right edge with animated chevron arrow
// • Drag left to open / right to close (velocity + position snapping)
// • Tap indicator to toggle
// • Click-outside overlay dismisses
// • Spring physics: damping 25, stiffness 300, mass 0.9
// • Lucide icons, NativeWind className, borderCurve continuous
// ============================================================

import React, { useCallback } from "react";
import { View, Pressable, Text, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import {
  Type,
  Pencil,
  Smile,
  Sparkles,
  SlidersHorizontal,
  Undo2,
  Redo2,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { EditorMode } from "../../types";

// Spring config from the reference — snappy with minimal overshoot
const SPRING = {
  damping: 25,
  stiffness: 300,
  mass: 0.9,
  overshootClamping: false,
  restDisplacementThreshold: 0.01,
  restSpeedThreshold: 0.01,
};

const PANEL_WIDTH = 140;
const INDICATOR_W = 26;
const INDICATOR_H = 100;
const OPTION_HEIGHT = 72;
const BG_COLOR = "#000";
const INDICATOR_COLOR = "#FF5BFC";
const BORDER_COLOR = "#555";
const TEXT_COLOR = "#B3AFAF";
const ICON_COLOR = "#B3AFAF";
const ACTIVE_ICON = "#fff";

interface RightIslandMenuProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  allowedModes?: EditorMode[];
}

const TOOLS: { id: EditorMode; Icon: typeof Type; label: string }[] = [
  { id: "text", Icon: Type, label: "Text" },
  { id: "drawing", Icon: Pencil, label: "Draw" },
  { id: "sticker", Icon: Smile, label: "Stickers" },
  { id: "filter", Icon: Sparkles, label: "Effects" },
  { id: "adjust", Icon: SlidersHorizontal, label: "Adjust" },
];

// Animated chevron arrow component
const AnimatedArrow = ({ isOpen }: { isOpen: SharedValue<number> }) => {
  const arrowStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(isOpen.value, [0, 1], [0, 180])}deg` },
    ],
  }));

  return (
    <Animated.View style={arrowStyle}>
      <Svg width={12} height={20} viewBox="0 0 12 20" fill="none">
        <Path
          d="M10 2L2 10L10 18"
          stroke="#fff"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </Animated.View>
  );
};

export const RightIslandMenu: React.FC<RightIslandMenuProps> = React.memo(
  ({
    mode,
    onModeChange,
    onUndo,
    onRedo,
    canUndo,
    canRedo,
    allowedModes,
  }) => {
    const { height: screenH } = useWindowDimensions();
    const isOpen = useSharedValue(0); // 0 = collapsed, 1 = expanded
    const visibleTools = React.useMemo(
      () =>
        allowedModes?.length
          ? TOOLS.filter((tool) => allowedModes.includes(tool.id))
          : TOOLS,
      [allowedModes],
    );

    // Total panel height: tools + undo/redo row + padding
    const panelH = visibleTools.length * OPTION_HEIGHT + OPTION_HEIGHT + 32;

    const hapticFeedback = useCallback(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }, []);

    const openMenu = useCallback(() => {
      hapticFeedback();
      isOpen.value = withSpring(1, SPRING);
    }, [isOpen, hapticFeedback]);

    const closeMenu = useCallback(() => {
      hapticFeedback();
      isOpen.value = withSpring(0, SPRING);
    }, [isOpen, hapticFeedback]);

    const toggleMenu = useCallback(() => {
      if (isOpen.value > 0.5) {
        closeMenu();
      } else {
        openMenu();
      }
    }, [isOpen, openMenu, closeMenu]);

    const handleToolPress = useCallback(
      (toolId: EditorMode) => {
        hapticFeedback();
        onModeChange(mode === toolId ? "idle" : toolId);
        isOpen.value = withSpring(0, SPRING);
      },
      [mode, onModeChange, isOpen, hapticFeedback],
    );

    // Drag gesture on the indicator — swipe left to open, right to close
    const dragGesture = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .onUpdate((e) => {
        "worklet";
        // Map drag to 0-1 range (dragging left = opening)
        const progress = interpolate(
          e.translationX,
          [-PANEL_WIDTH, 0, PANEL_WIDTH],
          [1, isOpen.value > 0.5 ? 1 : 0, 0],
          Extrapolation.CLAMP,
        );
        isOpen.value = progress;
      })
      .onEnd((e) => {
        "worklet";
        // Velocity-based snapping: fast flick snaps to nearest edge
        if (Math.abs(e.velocityX) > 500) {
          isOpen.value = withSpring(e.velocityX < 0 ? 1 : 0, SPRING);
        } else {
          // Position-based snapping
          isOpen.value = withSpring(isOpen.value > 0.5 ? 1 : 0, SPRING);
        }
      });

    // Tap on indicator to toggle
    const tapGesture = Gesture.Tap().onEnd(() => {
      "worklet";
      runOnJS(toggleMenu)();
    });

    const indicatorGesture = Gesture.Race(dragGesture, tapGesture);

    // The entire container translates: starts with panel off-screen, indicator visible
    const containerStyle = useAnimatedStyle(() => {
      const translateX = interpolate(
        isOpen.value,
        [0, 1],
        [PANEL_WIDTH, 0],
        Extrapolation.CLAMP,
      );
      return {
        transform: [{ translateX }],
      };
    });

    // Click-outside overlay opacity
    const overlayStyle = useAnimatedStyle(() => ({
      opacity: interpolate(isOpen.value, [0, 1], [0, 1]),
      pointerEvents: isOpen.value > 0.5 ? "auto" : "none",
    }));

    // Center vertically
    const topOffset = (screenH - panelH) / 2;

    return (
      <>
        {/* Click-outside overlay — dismisses menu */}
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 89,
            },
            overlayStyle,
          ]}
        >
          <Pressable className="flex-1" onPress={closeMenu} />
        </Animated.View>

        {/* Menu container (indicator + panel) */}
        <Animated.View
          style={[
            {
              position: "absolute",
              right: 0,
              top: topOffset,
              flexDirection: "row",
              zIndex: 90,
            },
            containerStyle,
          ]}
        >
          {/* Indicator tab — always flush to right edge of container */}
          <GestureDetector gesture={indicatorGesture}>
            <Animated.View
              style={{
                width: INDICATOR_W,
                height: INDICATOR_H,
                backgroundColor: INDICATOR_COLOR,
                borderTopLeftRadius: 14,
                borderBottomLeftRadius: 14,
                borderCurve: "continuous",
                justifyContent: "center",
                alignItems: "center",
                alignSelf: "center",
                boxShadow: "-2px 0px 10px rgba(255,91,252,0.35)",
              }}
            >
              <AnimatedArrow isOpen={isOpen} />
            </Animated.View>
          </GestureDetector>

          {/* Expanded panel */}
          <View
            style={{
              width: PANEL_WIDTH,
              backgroundColor: BG_COLOR,
              borderTopLeftRadius: 20,
              borderBottomLeftRadius: 20,
              borderCurve: "continuous",
              paddingVertical: 16,
              borderWidth: 1,
              borderRightWidth: 0,
              borderColor: BORDER_COLOR,
              boxShadow: "-4px 0px 16px rgba(0,0,0,0.5)",
            }}
          >
            {/* Undo / Redo row */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "center",
                gap: 16,
                height: OPTION_HEIGHT,
                alignItems: "center",
                borderBottomWidth: 1,
                borderBottomColor: "rgba(255,255,255,0.08)",
              }}
            >
              <Pressable
                onPress={() => {
                  hapticFeedback();
                  onUndo();
                }}
                disabled={!canUndo}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  justifyContent: "center",
                  alignItems: "center",
                  opacity: canUndo ? 1 : 0.25,
                }}
              >
                <Undo2 size={18} color={ACTIVE_ICON} strokeWidth={2} />
              </Pressable>
              <Pressable
                onPress={() => {
                  hapticFeedback();
                  onRedo();
                }}
                disabled={!canRedo}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 12,
                  borderCurve: "continuous",
                  backgroundColor: "rgba(255,255,255,0.08)",
                  justifyContent: "center",
                  alignItems: "center",
                  opacity: canRedo ? 1 : 0.25,
                }}
              >
                <Redo2 size={18} color={ACTIVE_ICON} strokeWidth={2} />
              </Pressable>
            </View>

            {/* Tool options */}
            {visibleTools.map((tool) => {
              const isActive = mode === tool.id;
              return (
                <Pressable
                  key={tool.id}
                  onPress={() => handleToolPress(tool.id)}
                  style={{
                    height: OPTION_HEIGHT,
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: isActive
                      ? "rgba(59,130,246,0.25)"
                      : "transparent",
                    borderLeftWidth: isActive ? 3 : 0,
                    borderLeftColor: isActive ? "#3B82F6" : "transparent",
                  }}
                >
                  <tool.Icon
                    size={22}
                    color={isActive ? ACTIVE_ICON : ICON_COLOR}
                    strokeWidth={isActive ? 2.2 : 1.6}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: isActive ? ACTIVE_ICON : TEXT_COLOR,
                    }}
                  >
                    {tool.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Animated.View>
      </>
    );
  },
);

RightIslandMenu.displayName = "RightIslandMenu";
