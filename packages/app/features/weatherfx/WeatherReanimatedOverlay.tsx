/**
 * WeatherReanimatedOverlay — Reanimated-based weather particle renderer
 *
 * Fallback (or primary) weather animation that doesn't depend on WebGPU.
 * Uses Reanimated shared values for smooth 60fps particle animation.
 *
 * Renders snow, rain, fog overlays based on WeatherFXStore state.
 * Mounted in ProtectedLayout alongside (or instead of) WeatherGPUEngine.
 *
 * Brand colors: Rain=#8A40CF  Snow=#3FDCFF  Sunny=#FC253A
 */

import React, { memo, useEffect, useMemo, useRef } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  withSequence,
  Easing,
  interpolate,
  cancelAnimation,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import { useWeatherFXStore } from "./WeatherFXStore";
import { WeatherEffect, CinematicPhase } from "./weatherTypes";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

// ── Particle config per effect ──────────────────────────────────────

const SNOW_COUNT = 40;
const RAIN_COUNT = 50;

interface ParticleConfig {
  x: number; // 0–1 normalized start X
  size: number;
  speed: number; // duration in ms for one fall
  delay: number; // initial delay
  drift: number; // horizontal drift amount
  opacity: number;
}

function generateSnowParticles(): ParticleConfig[] {
  return Array.from({ length: SNOW_COUNT }, () => ({
    x: Math.random(),
    size: 2 + Math.random() * 4,
    speed: 6000 + Math.random() * 8000,
    delay: Math.random() * 4000,
    drift: (Math.random() - 0.5) * 60,
    opacity: 0.3 + Math.random() * 0.5,
  }));
}

function generateRainParticles(): ParticleConfig[] {
  return Array.from({ length: RAIN_COUNT }, () => ({
    x: Math.random(),
    size: 1 + Math.random() * 1.5,
    speed: 800 + Math.random() * 1200,
    delay: Math.random() * 2000,
    drift: (Math.random() - 0.5) * 10,
    opacity: 0.2 + Math.random() * 0.4,
  }));
}

// ── Single animated particle ────────────────────────────────────────

const SnowParticle = memo(function SnowParticle({
  config,
}: {
  config: ParticleConfig;
}) {
  const progress = useSharedValue(0);
  const driftVal = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(1, { duration: config.speed, easing: Easing.linear }),
        -1,
        false,
      ),
    );
    driftVal.value = withDelay(
      config.delay,
      withRepeat(
        withSequence(
          withTiming(1, {
            duration: config.speed / 2,
            easing: Easing.inOut(Easing.sin),
          }),
          withTiming(0, {
            duration: config.speed / 2,
            easing: Easing.inOut(Easing.sin),
          }),
        ),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(progress);
      cancelAnimation(driftVal);
    };
  }, [config.delay, config.speed]);

  const animatedStyle = useAnimatedStyle(() => {
    const y = interpolate(
      progress.value,
      [0, 1],
      [-config.size, SCREEN_H + config.size],
    );
    const x =
      config.x * SCREEN_W +
      interpolate(driftVal.value, [0, 1], [-config.drift, config.drift]);
    return {
      transform: [{ translateX: x }, { translateY: y }],
      opacity:
        config.opacity *
        interpolate(progress.value, [0, 0.05, 0.9, 1], [0, 1, 1, 0]),
    };
  }, []);

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
          backgroundColor: "#3FDCFF",
        },
        animatedStyle,
      ]}
    />
  );
});

const RainDrop = memo(function RainDrop({
  config,
}: {
  config: ParticleConfig;
}) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      config.delay,
      withRepeat(
        withTiming(1, { duration: config.speed, easing: Easing.linear }),
        -1,
        false,
      ),
    );

    return () => {
      cancelAnimation(progress);
    };
  }, [config.delay, config.speed]);

  const animatedStyle = useAnimatedStyle(() => {
    const y = interpolate(progress.value, [0, 1], [-20, SCREEN_H + 20]);
    const x = config.x * SCREEN_W + config.drift * progress.value;
    return {
      transform: [{ translateX: x }, { translateY: y }],
      opacity:
        config.opacity *
        interpolate(progress.value, [0, 0.02, 0.85, 1], [0, 1, 1, 0]),
    };
  }, []);

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: config.size,
          height: 12 + config.size * 4,
          borderRadius: config.size / 2,
          backgroundColor: "#8A40CF",
        },
        animatedStyle,
      ]}
    />
  );
});

// ── Fog overlay ─────────────────────────────────────────────────────

function FogOverlay({ density }: { density: number }) {
  const pulseVal = useSharedValue(0);

  useEffect(() => {
    pulseVal.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 8000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(pulseVal);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    opacity: density * (0.8 + pulseVal.value * 0.2),
  }));

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: "rgba(63, 220, 255, 0.06)" },
        animStyle,
      ]}
    />
  );
}

// ── Main overlay ────────────────────────────────────────────────────

function WeatherReanimatedOverlayInner() {
  const eventsTabVisible = useWeatherFXStore((s) => s.eventsTabVisible);
  const selectedEffect = useWeatherFXStore((s) => s.selectedEffect);
  const weatherAmbianceEnabled = useWeatherFXStore(
    (s) => s.weatherAmbianceEnabled,
  );
  const intensity = useWeatherFXStore((s) => s.intensity);
  const burstActive = useWeatherFXStore((s) => s.burstActive);
  const burstEndTime = useWeatherFXStore((s) => s.burstEndTime);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auto-end burst after 30s using burstEndTime from store
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!burstActive || !burstEndTime) return;

    const remaining = burstEndTime - Date.now();
    if (remaining <= 0) {
      useWeatherFXStore.getState().endBurst();
      return;
    }

    // Check every second if burst should end
    timerRef.current = setInterval(() => {
      if (Date.now() >= burstEndTime) {
        useWeatherFXStore.getState().endBurst();
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [burstActive, burstEndTime]);

  const snowParticles = useMemo(() => generateSnowParticles(), []);
  const rainParticles = useMemo(() => generateRainParticles(), []);

  // Only render during an active 30s burst
  if (
    !eventsTabVisible ||
    !weatherAmbianceEnabled ||
    !burstActive ||
    selectedEffect === WeatherEffect.None
  ) {
    return null;
  }

  const isSnow = selectedEffect === WeatherEffect.Snow;
  const isRain =
    selectedEffect === WeatherEffect.Rain ||
    selectedEffect === WeatherEffect.HeavyRain ||
    selectedEffect === WeatherEffect.Thunder;
  const isFog =
    selectedEffect === WeatherEffect.Fog ||
    selectedEffect === WeatherEffect.Cloudy;
  const isClear = selectedEffect === WeatherEffect.Clear;

  return (
    <Animated.View
      entering={FadeIn.duration(800)}
      exiting={FadeOut.duration(600)}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Fog / Cloudy overlay */}
      {isFog && <FogOverlay density={intensity.fogDensity} />}

      {/* Snow particles */}
      {isSnow &&
        snowParticles.map((config, i) => (
          <SnowParticle key={`snow-${i}`} config={config} />
        ))}

      {/* Rain particles */}
      {isRain &&
        rainParticles.map((config, i) => (
          <RainDrop key={`rain-${i}`} config={config} />
        ))}

      {/* Clear — very subtle ambient motes */}
      {isClear &&
        snowParticles
          .slice(0, 15)
          .map((config, i) => (
            <SnowParticle
              key={`mote-${i}`}
              config={{
                ...config,
                opacity: config.opacity * 0.15,
                size: config.size * 0.6,
              }}
            />
          ))}
    </Animated.View>
  );
}

export const WeatherReanimatedOverlay = memo(WeatherReanimatedOverlayInner);
