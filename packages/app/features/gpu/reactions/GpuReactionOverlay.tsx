/**
 * GPU reaction overlay — its own WebGPU surface above the room UI.
 *
 * Deliberately NOT composited into the video path: reactions must never be able
 * to stall, tint, or drop a frame of somebody's stream. This is a transparent
 * sibling canvas with `pointerEvents="none"`, so the room's touch targets are
 * untouched too.
 *
 * The room's existing `useRoomReactions` transport is the only input — this
 * reads the same array the RN/DOM overlay reads and spawns one instance per
 * reaction it hasn't seen. If WebGPU or the atlas is unavailable the component
 * renders nothing and reports it, and the caller keeps the RN/DOM path mounted.
 *
 * Runs its own rAF scoped to this component rather than joining
 * `WorkletRenderLoop`, which is an app-wide singleton whose second `start()` is
 * a silent no-op — sharing it would mean one room could mute another surface.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Canvas, useCanvasRef, useDevice } from "react-native-webgpu";
import type { RoomReaction } from "@dvnt/app/features/sneaky-lynk";
import { isWebGPUAvailable } from "../GpuRuntime";
import { getEmojiAtlas } from "./emojiAtlas";
import { createReactionEngine, type ReactionEngine } from "./engine";

export interface GpuReactionOverlayProps {
  /** Live reactions from `useRoomReactions` — unchanged transport. */
  reactions: RoomReaction[];
  /** The room's reaction palette; defines the atlas cell order. */
  emojis: string[];
  /** Pause the loop when the room is backgrounded or off-screen. */
  paused?: boolean;
  /**
   * Reports whether the GPU path is actually carrying reactions. Keep the
   * RN/DOM overlay mounted until this reports `true`.
   */
  onAvailabilityChange?: (available: boolean) => void;
  style?: StyleProp<ViewStyle>;
}

export function GpuReactionOverlay({
  reactions,
  emojis,
  paused = false,
  onAvailabilityChange,
  style,
}: GpuReactionOverlayProps) {
  const supported = isWebGPUAvailable();
  const canvasRef = useCanvasRef();
  const { device } = useDevice();

  const engineRef = useRef<ReactionEngine | null>(null);
  const seenRef = useRef(new Set<string>());
  const [ready, setReady] = useState(false);

  const report = useRef(onAvailabilityChange);
  report.current = onAvailabilityChange;

  // Build the engine once the device and canvas both exist.
  useEffect(() => {
    if (!supported || !device) return;
    const context = canvasRef.current?.getContext("webgpu");
    if (!context) return;

    const atlas = getEmojiAtlas(emojis);
    if (!atlas) {
      report.current?.(false);
      return;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });

    const engine = createReactionEngine(device, format, atlas);
    if (!engine) {
      report.current?.(false);
      return;
    }

    engineRef.current = engine;
    setReady(true);
    report.current?.(true);

    return () => {
      engineRef.current = null;
      setReady(false);
      report.current?.(false);
      engine.destroy();
    };
  }, [supported, device, emojis, canvasRef]);

  // Feed new reactions in. `seenRef` is what keeps a re-render from re-spawning
  // everything currently on screen.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    for (const reaction of reactions) {
      if (seenRef.current.has(reaction.id)) continue;
      seenRef.current.add(reaction.id);
      engine.spawn({ emoji: reaction.emoji, isOwn: reaction.isOwn });
    }
    // The transport already drops reactions after its TTL, so bound the id set
    // to the ring capacity rather than letting a long room grow it forever.
    if (seenRef.current.size > 256) {
      seenRef.current = new Set(reactions.map((r) => r.id));
    }
  }, [reactions]);

  const frame = useCallback(() => {
    const engine = engineRef.current;
    const context = canvasRef.current?.getContext("webgpu");
    if (!engine || !context) return;
    engine.render(context, performance.now());
    context.present?.();
  }, [canvasRef]);

  useEffect(() => {
    if (!ready || paused) return;
    let raf = 0;
    const loop = () => {
      frame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, paused, frame]);

  if (!supported) return null;

  return (
    <Canvas
      ref={canvasRef}
      transparent
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, style]}
    />
  );
}
