/**
 * Weather GPU Engine — Persistent overlay component
 *
 * SINGLETON: Module-level lock prevents double-mount.
 * Mount location: ProtectedLayout (above tabs, never remounts on tab switch).
 *
 * Lifecycle:
 * 1. Async GPU init (never blocks UI)
 * 2. Init all layers once device ready
 * 3. Start render loop
 * 4. Visibility drives opacity fade (WorkletRenderLoop)
 * 5. Weather changes crossfade layers via uniform updates
 * 6. Cinematic plays at most once/day + once/session
 *
 * Brand colors: Rain=#8A40CF Snow=#3FDCFF Sunny=#FC253A
 */
import React, { useEffect, useRef } from "react";
import { View, StyleSheet, AccessibilityInfo, Platform } from "react-native";
import { GpuRuntime, isWebGPUAvailable } from "@/src/gpu/GpuRuntime";
import { WorkletRenderLoop } from "@/src/gpu/WorkletRenderLoop";
import { useWeatherFXStore } from "./WeatherFXStore";
import {
  WeatherEffect,
  CinematicPhase,
  type LayerUniforms,
} from "./weatherTypes";
import { RainLayer } from "./layers/RainLayer";
import { SnowLayer } from "./layers/SnowLayer";
import { FogLayer } from "./layers/FogLayer";
import { ThunderOverlay } from "./layers/ThunderOverlay";
import { PostFXPass } from "./postfx/PostFXPass";
import { WeatherAudioEngine } from "../weatheraudio/WeatherAudioEngine";

// ── Safe import of react-native-wgpu Canvas ─────────────────────────
let WgpuCanvas: React.ComponentType<any> | null = null;
let useCanvasEffect: any = null;
try {
  const wgpu = require("react-native-wgpu");
  WgpuCanvas = wgpu.Canvas;
  useCanvasEffect = wgpu.useCanvasEffect;
} catch {
  // Not available — graceful no-op
}

// ── Singleton guard ─────────────────────────────────────────────────
let _instanceMounted = false;

// ── Cinematic timing ────────────────────────────────────────────────
const CINEMATIC_DURATION_S = 2.5;
const CINEMATIC_FADE_OUT_S = 0.8;

// ── Helper: today as YYYY-MM-DD ─────────────────────────────────────
function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Internal Canvas Renderer ────────────────────────────────────────
function WeatherCanvas() {
  if (!useCanvasEffect || !WgpuCanvas) return null;

  const canvasRef = useCanvasEffect(async () => {
    // Init GPU device (once for entire app)
    const ready = await GpuRuntime.initOnce();
    if (!ready) {
      console.warn("[WeatherGPUEngine] GPU init failed — no effects");
      return;
    }

    const device = GpuRuntime.getDevice();
    if (!device || !canvasRef.current) return;

    // Get canvas context
    const ctx = canvasRef.current.getContext("webgpu");
    if (!ctx) {
      console.warn("[WeatherGPUEngine] Failed to get webgpu context");
      return;
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: "premultiplied" });

    // Init all layers in parallel
    const [rainOk, snowOk, fogOk, thunderOk, postfxOk] = await Promise.all([
      RainLayer.init(format),
      SnowLayer.init(format),
      FogLayer.init(format),
      ThunderOverlay.init(format),
      PostFXPass.init(format),
    ]);

    if (__DEV__) {
      console.log(
        `[WeatherGPUEngine] Layers: rain=${rainOk} snow=${snowOk} fog=${fogOk} thunder=${thunderOk} postfx=${postfxOk}`,
      );
    }

    // Mark GPU ready in store
    useWeatherFXStore.getState().setGpuReady(true);

    // Get canvas dimensions
    const canvas = canvasRef.current;
    const width = canvas.width || 390;
    const height = canvas.height || 844;
    const resolution: [number, number] = [width, height];

    // Cinematic state
    let cinematicTimer = 0;
    let cinematicStarted = false;

    // Start render loop
    WorkletRenderLoop.start((dt, time, loopOpacity) => {
      const store = useWeatherFXStore.getState();
      const effect = store.selectedEffect;
      const intensity = store.intensity;
      const particleCount = store.effectiveParticleCount();
      const effectOpacity = store.effectiveOpacity();
      const postfxEnabled =
        !store.reduceMotion &&
        !store.lowPower &&
        (store.batteryLevel == null || store.batteryLevel > 0.2);

      // 30s burst gating — skip rendering when burst is inactive
      if (!store.burstActive) return;
      if (store.burstEndTime && Date.now() >= store.burstEndTime) {
        store.endBurst();
        return;
      }

      // Cinematic logic
      let cinematicMul = 1;
      if (store.cinematicPhase === CinematicPhase.Playing) {
        cinematicTimer += dt;
        if (cinematicTimer < CINEMATIC_DURATION_S) {
          // Ramp up fast then hold
          cinematicMul = Math.min(cinematicTimer / 0.4, 2.5);
        } else if (
          cinematicTimer <
          CINEMATIC_DURATION_S + CINEMATIC_FADE_OUT_S
        ) {
          // Fade cinematic intensity down to ambient
          const fadeProgress =
            (cinematicTimer - CINEMATIC_DURATION_S) / CINEMATIC_FADE_OUT_S;
          cinematicMul = 2.5 - fadeProgress * 1.5; // 2.5 → 1.0
        } else {
          cinematicMul = 1;
          store.setCinematicPhase(CinematicPhase.Done);
        }
      }

      const finalOpacity =
        effectOpacity * loopOpacity * Math.min(cinematicMul, 2.5);
      if (finalOpacity < 0.001) return;

      // Build uniforms (reused object pattern — no allocation)
      const uniforms: LayerUniforms = {
        time,
        dt,
        resolution,
        opacity: finalOpacity,
        windX: intensity.windVector[0],
        windY: intensity.windVector[1],
        intensity: store.effectIntensityScale,
        speed: intensity.speed,
      };

      // Acquire texture + create encoder
      let textureView: GPUTextureView;
      try {
        textureView = ctx.getCurrentTexture().createView();
      } catch {
        return; // canvas not ready
      }

      const encoder = GpuRuntime.createCommandEncoder("weather-frame");
      if (!encoder) return;

      // Compute passes (particle simulation)
      const needsRain =
        effect === WeatherEffect.Rain ||
        effect === WeatherEffect.HeavyRain ||
        effect === WeatherEffect.Thunder;
      const needsSnow = effect === WeatherEffect.Snow;

      if (needsRain) {
        RainLayer.update(encoder, uniforms, particleCount);
      }
      if (needsSnow) {
        SnowLayer.update(encoder, uniforms, particleCount);
      }

      // Render pass (all layers draw into same pass)
      const renderPass = encoder.beginRenderPass({
        label: "weather-render",
        colorAttachments: [
          {
            view: textureView,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear" as GPULoadOp,
            storeOp: "store" as GPUStoreOp,
          },
        ],
      });

      // Draw order: fog → particles → thunder → postfx
      const needsFog =
        effect === WeatherEffect.Fog || effect === WeatherEffect.Cloudy;
      if (needsFog) {
        FogLayer.update(uniforms, intensity.fogDensity);
        FogLayer.render(renderPass);
      }

      if (needsRain) {
        RainLayer.render(renderPass, particleCount);
      }
      if (needsSnow) {
        SnowLayer.render(renderPass, particleCount);
      }

      if (effect === WeatherEffect.Thunder) {
        ThunderOverlay.update(uniforms, intensity.thunderChance * cinematicMul);
        ThunderOverlay.render(renderPass);
      }

      // PostFX (film grain + vignette + color grading)
      PostFXPass.update(
        time,
        resolution,
        effect,
        finalOpacity * 0.6,
        postfxEnabled,
      );
      PostFXPass.render(renderPass, postfxEnabled);

      renderPass.end();
      GpuRuntime.submitCommands(encoder);

      // Present
      try {
        ctx.present?.();
      } catch {}
    });

    // Cleanup function
    return () => {
      WorkletRenderLoop.stop();
    };
  });

  return <WgpuCanvas ref={canvasRef} style={StyleSheet.absoluteFill} />;
}

// ── Main exported component ─────────────────────────────────────────
export function WeatherGPUEngine() {
  const eventsTabVisible = useWeatherFXStore((s) => s.eventsTabVisible);
  const selectedEffect = useWeatherFXStore((s) => s.selectedEffect);
  const weatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.weatherAmbianceEnabled,
  );
  const gpuReady = useWeatherFXStore((s) => s.gpuReady);
  const effectIntensityScale = useWeatherFXStore((s) => s.effectIntensityScale);
  const mountedRef = useRef(false);

  // ── Singleton guard ─────────────────────────────────────────────
  useEffect(() => {
    if (_instanceMounted) {
      if (__DEV__) {
        console.warn(
          "[WeatherGPUEngine] SINGLETON VIOLATION — second mount blocked",
        );
      }
      return;
    }
    _instanceMounted = true;
    mountedRef.current = true;

    return () => {
      _instanceMounted = false;
      mountedRef.current = false;
      WorkletRenderLoop.stop();
      WeatherAudioEngine.dispose();
    };
  }, []);

  // ── Accessibility + battery/low power flags ───────────────────────
  useEffect(() => {
    const checkFlags = async () => {
      try {
        const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();

        let lowPower = false;
        let batteryLevel: number | null = null;
        try {
          const Battery = require("expo-battery");
          const [level, lowPowerMode] = await Promise.all([
            Battery.getBatteryLevelAsync?.().catch(() => null),
            Battery.isLowPowerModeEnabled?.().catch(() => false),
          ]);
          batteryLevel = level;
          lowPower = lowPowerMode ?? false;
        } catch {
          // expo-battery not available (OTA without native build)
        }

        useWeatherFXStore
          .getState()
          .setFlags(reduceMotion, lowPower, batteryLevel);
      } catch {}
    };
    checkFlags();

    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        const s = useWeatherFXStore.getState();
        s.setFlags(enabled, s.lowPower, s.batteryLevel);
      },
    );

    return () => sub.remove();
  }, []);

  // ── Visibility → render loop + audio ────────────────────────────
  useEffect(() => {
    WorkletRenderLoop.setVisible(eventsTabVisible && weatherAmbianceEnabled);
    WeatherAudioEngine.setVisible(eventsTabVisible && weatherAmbianceEnabled);
  }, [eventsTabVisible, weatherAmbianceEnabled]);

  // ── Effect changes → audio crossfade ────────────────────────────
  useEffect(() => {
    if (weatherAmbianceEnabled) {
      WeatherAudioEngine.setEffect(selectedEffect);
    }
  }, [selectedEffect, weatherAmbianceEnabled]);

  // ── Intensity scale → audio ─────────────────────────────────────
  useEffect(() => {
    WeatherAudioEngine.setIntensityScale(effectIntensityScale);
  }, [effectIntensityScale]);

  // ── Cinematic trigger (once/day + once/session) ─────────────────
  useEffect(() => {
    if (
      !eventsTabVisible ||
      !gpuReady ||
      !weatherAmbianceEnabled ||
      selectedEffect === WeatherEffect.None
    ) {
      return;
    }

    const store = useWeatherFXStore.getState();
    const today = todayString();

    if (store.shouldPlayCinematicToday(today)) {
      store.markCinematicPlayed(today);
      store.setCinematicPhase(CinematicPhase.Playing);

      if (__DEV__) {
        console.log("[WeatherGPUEngine] Cinematic started for", selectedEffect);
      }
    }
  }, [eventsTabVisible, gpuReady, weatherAmbianceEnabled, selectedEffect]);

  // ── Don't render anything if WebGPU isn't available ─────────────
  if (!isWebGPUAvailable() || !WgpuCanvas || !weatherAmbianceEnabled) {
    return null;
  }

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <WeatherCanvas />
    </View>
  );
}
