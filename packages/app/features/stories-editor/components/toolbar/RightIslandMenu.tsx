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

import React, { useCallback, useEffect, useMemo } from "react";
import { View, Pressable, Text, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
  cancelAnimation,
  clamp,
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
import { useEditorStore } from "../../stores/editor-store";

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
    // Position lives on the UI thread; intent lives in the store. Keeping them
    // separate is what lets a drag and a tap interrupt each other cleanly.
    const progress = useSharedValue(0); // 0 = collapsed, 1 = expanded
    const startProgress = useSharedValue(0);
    const railOpen = useEditorStore((s) => s.railOpen);
    const setRailOpen = useEditorStore((s) => s.setRailOpen);
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

    // withSpring starts from the value the rail currently holds, so a tap during
    // an in-flight spring reverses from that point instead of snapping first.
    useEffect(() => {
      progress.value = withSpring(railOpen ? 1 : 0, SPRING);
    }, [railOpen, progress]);

    const openMenu = useCallback(() => {
      hapticFeedback();
      setRailOpen(true);
    }, [setRailOpen, hapticFeedback]);

    const closeMenu = useCallback(() => {
      hapticFeedback();
      setRailOpen(false);
    }, [setRailOpen, hapticFeedback]);

    const toggleMenu = useCallback(() => {
      // getState() instead of the subscribed value: this callback is captured by
      // a gesture worklet that outlives the render it was created in.
      if (useEditorStore.getState().railOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    }, [openMenu, closeMenu]);

    const handleToolPress = useCallback(
      (toolId: EditorMode) => {
        hapticFeedback();
        onModeChange(mode === toolId ? "idle" : toolId);
        setRailOpen(false);
      },
      [mode, onModeChange, setRailOpen, hapticFeedback],
    );

    // Drag gesture on the indicator — swipe left to open, right to close
    const dragGesture = useMemo(
      () =>
        Gesture.Pan()
          .activeOffsetX([-10, 10])
          .onBegin(() => {
            cancelAnimation(progress);
            startProgress.value = progress.value;
          })
          .onUpdate((e) => {
            progress.value = clamp(
              startProgress.value - e.translationX / PANEL_WIDTH,
              0,
              1,
            );
          })
          .onEnd((e) => {
            // Project the flick forward so a fast swipe past the midpoint wins
            // even when the finger lifted short of it.
            const projected = progress.value - e.velocityX / (PANEL_WIDTH * 4);
            const open = projected > 0.5;
            progress.value = withSpring(open ? 1 : 0, SPRING);
            runOnJS(setRailOpen)(open);
          }),
      [progress, startProgress, setRailOpen],
    );

    // Tap on indicator to toggle
    const tapGesture = useMemo(
      () =>
        Gesture.Tap().onEnd(() => {
          runOnJS(toggleMenu)();
        }),
      [toggleMenu],
    );

    const indicatorGesture = useMemo(
      () => Gesture.Race(dragGesture, tapGesture),
      [dragGesture, tapGesture],
    );

    // The entire container translates: starts with panel off-screen, indicator visible
    const containerStyle = useAnimatedStyle(() => {
      const translateX = interpolate(
        progress.value,
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
      opacity: interpolate(progress.value, [0, 1], [0, 1]),
      pointerEvents: progress.value > 0.5 ? "auto" : "none",
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
              <AnimatedArrow isOpen={progress} />
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
