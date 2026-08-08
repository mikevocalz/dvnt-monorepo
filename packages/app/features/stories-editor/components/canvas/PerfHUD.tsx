// ============================================================
// PerfHUD — Lightweight performance overlay for the Story Editor
// ============================================================
// Shows JS/UI thread FPS, element count, and drawing point count.
// Toggle via a dev-only button or long-press gesture.
// ============================================================

import React, { useEffect, useRef, useReducer } from "react";
import { View, Text } from "react-native";

interface PerfHUDProps {
  visible: boolean;
  elementCount: number;
  drawingPathCount: number;
  drawingPointCount: number;
}

export const PerfHUD: React.FC<PerfHUDProps> = React.memo(
  ({ visible, elementCount, drawingPathCount, drawingPointCount }) => {
    const fpsRef = useRef(0);
    const frameCount = useRef(0);
    const lastTime = useRef(Date.now());
    const [, forceRender] = useReducer((x: number) => x + 1, 0);

    useEffect(() => {
      if (!visible) return;

      let rafId: number;
      const tick = () => {
        frameCount.current++;
        const now = Date.now();
        if (now - lastTime.current >= 1000) {
          fpsRef.current = frameCount.current;
          frameCount.current = 0;
          lastTime.current = now;
          forceRender();
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }, [visible]);

    if (!visible) return null;

    return (
      <View
        className="absolute top-[50px] left-2 bg-black/60 px-2 py-1 rounded-md gap-0.5"
        pointerEvents="none"
      >
        <Text
          className="text-[#0f0] text-[10px] font-semibold"
          style={{ fontFamily: "monospace" }}
        >
          JS {fpsRef.current} fps
        </Text>
        <Text
          className="text-[#0f0] text-[10px] font-semibold"
          style={{ fontFamily: "monospace" }}
        >
          {elementCount} layers · {drawingPathCount} paths · {drawingPointCount}{" "}
          pts
        </Text>
      </View>
    );
  },
);

PerfHUD.displayName = "PerfHUD";
