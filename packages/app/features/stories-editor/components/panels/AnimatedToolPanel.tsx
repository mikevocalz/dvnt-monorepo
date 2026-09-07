// ============================================================
// AnimatedToolPanel — Reanimated-powered slide-up tool panel
// ============================================================
// Replaces @gorhom/bottom-sheet ToolPanelContainer.
// Key improvements:
//   • Does NOT intercept touches above the panel — canvas/elements
//     remain interactive while panel is open
//   • Pan-to-dismiss gesture on the handle bar
//   • Spring animation for open/close
//   • Same visual language as before (#1a1a1a, rounded corners)
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Platform, View, StyleSheet, useWindowDimensions } from "react-native";
import { BlurView } from "expo-blur";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import {
  SafeLiquidGlassView as LiquidGlassView,
  safeIsLiquidGlassSupported as isLiquidGlassSupported,
} from "@dvnt/app/lib/safe-native-modules";
import { GLASS_SURFACE, createGlassScrimStyle } from "@dvnt/app/lib/ui/glass";
import {
  SHEET_BOTTOM_INSET,
  useDetachedSheetMetrics,
} from "@dvnt/app/lib/ui/sheet-metrics";
import { useEditorStore } from "../../stores/editor-store";
import type { Presence } from "../../types";

const SPRING = {
  damping: 22,
  stiffness: 280,
  mass: 0.9,
  overshootClamping: false,
};

// Presence lives in the editor store (keyed by panel id) because Zustand is the
// only state store here. The transitions stay in this pure reducer.
type PresenceEvent = "open" | "opened" | "close" | "closed";

function presenceReducer(state: Presence, event: PresenceEvent): Presence {
  switch (event) {
    case "open":
      return state === "open" ? "open" : "opening";
    case "opened":
      return state === "opening" ? "open" : state;
    case "close":
      return state === "closed" ? "closed" : "closing";
    case "closed":
      return state === "closing" ? "closed" : state;
  }
}

interface AnimatedToolPanelProps {
  /** Stable, unique per mounted panel — keys this panel's presence in the store. */
  id: string;
  visible: boolean;
  onDismiss: () => void;
  /** Panel height as percentage of screen (0-1). Default 0.42 */
  heightRatio?: number;
  visualStyle?: "solid" | "glass";
  children: React.ReactNode;
}

export const AnimatedToolPanel: React.FC<AnimatedToolPanelProps> = React.memo(
  ({
    id,
    visible,
    onDismiss,
    heightRatio = 0.42,
    visualStyle = "solid",
    children,
  }) => {
    const { height: screenH } = useWindowDimensions();
    // Same detached geometry as every other sheet (`sheet-metrics`): capped at
    // max-w-3xl and centred, so this is not full-bleed on an iPad.
    const sheet = useDetachedSheetMetrics();
    const panelH = Math.min(Math.round(screenH * heightRatio), sheet.height);
    const isGlass = visualStyle === "glass";

    // 0 = fully open (panel at bottom), 1 = fully closed (panel off-screen)
    const progress = useSharedValue(1);

    // Narrow selector: a sibling panel's transition changes the record's identity
    // but not this string, so the other panels do not re-render.
    const presence = useEditorStore(
      (s): Presence => s.panelPresence[id] ?? "closed",
    );
    const setPanelPresence = useEditorStore((s) => s.setPanelPresence);

    const dispatch = useCallback(
      (event: PresenceEvent) => {
        // getState() so a transition never runs against a stale render's value.
        const current =
          useEditorStore.getState().panelPresence[id] ?? "closed";
        setPanelPresence(id, presenceReducer(current, event));
      },
      [id, setPanelPresence],
    );

    // Bumped on every visibility flip. A completion callback carries the token it
    // was created with, so a reopen makes the pending unmount a no-op.
    const generation = useRef(0);

    const settle = useCallback(
      (token: number, event: PresenceEvent) => {
        if (token === generation.current) {
          dispatch(event);
        }
      },
      [dispatch],
    );

    useEffect(() => {
      generation.current += 1;
      const token = generation.current;
      if (visible) {
        dispatch("open");
        progress.value = withSpring(0, SPRING, (finished) => {
          if (finished) {
            runOnJS(settle)(token, "opened");
          }
        });
      } else {
        dispatch("close");
        // Unmount is deferred to here so the closing spring is actually seen.
        progress.value = withSpring(1, SPRING, (finished) => {
          if (finished) {
            runOnJS(settle)(token, "closed");
          }
        });
      }
    }, [visible, progress, dispatch, settle]);

    // Drop this panel's entry so the record does not outlive the editor session.
    useEffect(
      () => () => {
        setPanelPresence(id, "closed");
      },
      [id, setPanelPresence],
    );

    const onDismissJS = useCallback(() => {
      onDismiss();
    }, [onDismiss]);

    // Pan gesture on the handle — drag down to dismiss
    const panGesture = useMemo(
      () =>
        Gesture.Pan()
          .onUpdate((e) => {
            // Map drag distance to 0-1 progress (drag down = towards close)
            const p = interpolate(
              e.translationY,
              [0, panelH],
              [0, 1],
              Extrapolation.CLAMP,
            );
            progress.value = p;
          })
          .onEnd((e) => {
            // Velocity-based snapping
            if (e.velocityY > 500 || progress.value > 0.35) {
              progress.value = withSpring(1, SPRING);
              runOnJS(onDismissJS)();
            } else {
              progress.value = withSpring(0, SPRING);
            }
          }),
      [panelH, progress, onDismissJS],
    );

    const panelStyle = useAnimatedStyle(() => ({
      transform: [
        {
          translateY: interpolate(
            progress.value,
            [0, 1],
            // + the detached lift, so it still clears the screen edge
            [0, panelH + SHEET_BOTTOM_INSET + 40],
            Extrapolation.CLAMP,
          ),
        },
      ],
    }));

    // Unmount is driven by presence reaching "closed", which only the close
    // animation's completion callback can do. The `visible` term just covers the
    // first frame after a reopen, before the effect has written "opening".
    if (!visible && presence === "closed") return null;

    return (
      <Animated.View
        pointerEvents={presence === "closing" ? "none" : "auto"}
        style={[
          styles.panelBase,
          {
            height: panelH,
            width: sheet.width,
            marginHorizontal: sheet.marginHorizontal,
          },
          isGlass ? styles.panelGlass : styles.panelSolid,
          panelStyle,
        ]}
      >
        {isGlass ? (
          isLiquidGlassSupported ? (
            <LiquidGlassView
              effect="regular"
              interactive
              style={StyleSheet.absoluteFill}
            >
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  createGlassScrimStyle("sheet"),
                ]}
              />
            </LiquidGlassView>
          ) : Platform.OS === "ios" ? (
            <BlurView
              intensity={34}
              tint="dark"
              style={StyleSheet.absoluteFill}
            >
              <View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  createGlassScrimStyle("sheet", true),
                ]}
              />
            </BlurView>
          ) : (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: GLASS_SURFACE.androidSurface },
              ]}
            />
          )
        ) : null}

        {/* Handle bar — draggable */}
        <GestureDetector gesture={panGesture}>
          <View
            style={styles.handleContainer}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: isGlass
                  ? "rgba(255,255,255,0.34)"
                  : "#555",
              }}
            />
          </View>
        </GestureDetector>

        {/* Panel content */}
        <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      </Animated.View>
    );
  },
);

AnimatedToolPanel.displayName = "AnimatedToolPanel";

const styles = StyleSheet.create({
  panelBase: {
    position: "absolute",
    bottom: SHEET_BOTTOM_INSET,
    left: 0,
    zIndex: 120,
    elevation: 24,
    // Detached, so all four corners round — not just the top two.
    borderRadius: 20,
    borderCurve: "continuous",
    overflow: "hidden",
  },
  panelSolid: {
    backgroundColor: "#1a1a1a",
  },
  panelGlass: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: GLASS_SURFACE.borderStrong,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
  },
  handleContainer: {
    paddingTop: 10,
    paddingBottom: 6,
    alignItems: "center",
    justifyContent: "center",
  },
});
