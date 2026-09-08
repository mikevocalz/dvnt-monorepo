/**
 * TierBadge — a membership tier as a metallic mark.
 *
 * WHAT THIS IS NOT: a verification checkmark. DVNT already verifies identity
 * (Didit / Persona) and `users.verified` renders its own mark. Those are
 * different claims — "this is a real person" versus "this person pays us" — and
 * the apps that fused them into one symbol made the check stop meaning
 * anything. Bumble is the model worth copying: a blue check for verified, a
 * separate mark for premium. So this sits BESIDE the verified check, never
 * replacing it, and never borrows the checkmark shape.
 *
 * The metal is a Skia runtime effect rather than a static gradient because a
 * flat fill at this size reads as plastic. Dark base, a travelling specular
 * band, a lit top edge — the minimum that says "milled from something".
 *
 * ponytail: the sweep is STATIC by default. A badge that shimmers forever
 * beside every username is a distraction and a per-frame cost in a list, so
 * motion is opt-in for the one place it earns attention — the award moment at
 * checkout.
 */

import React, { useMemo } from "react";
import { View, Text } from "react-native";
import {
  Canvas,
  Fill,
  Paint,
  Shader,
  Skia,
  useClock,
  type Uniforms,
} from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import type { PlanKey } from "@dvnt/app/lib/subscription/types";
import { tierIdentity } from "@dvnt/app/lib/theme/membership-tier";

/** `u_sweep` is where the specular band sits along the diagonal, 0..1. */
const SKSL = `
uniform float2 u_resolution;
uniform float3 u_shadow;
uniform float3 u_body;
uniform float3 u_highlight;
uniform float  u_sweep;

half4 main(float2 xy) {
  float2 uv = xy / u_resolution;

  // Diagonal position. The band travels along this axis, which is what makes a
  // flat fill read as a lit surface rather than a colour.
  float d = (uv.x + uv.y) * 0.5;

  float3 base = mix(u_shadow, u_body, smoothstep(0.0, 1.0, d));

  // Narrow, soft specular band. Wide looks like a gradient; hard looks like a
  // stripe.
  float band = exp(-pow((d - u_sweep) * 4.5, 2.0));
  float3 lit = mix(base, u_highlight, band * 0.85);

  // Lit top edge, dark bottom edge — gives the mark thickness.
  float edge = smoothstep(0.5, 0.0, uv.y) * 0.18
             - smoothstep(0.5, 1.0, uv.y) * 0.14;

  return half4(clamp(lit + edge, 0.0, 1.0), 1.0);
}
`;

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function TierBadge({
  plan,
  size = 16,
  animated = false,
  showLabel = false,
}: {
  plan: PlanKey | null | undefined;
  size?: number;
  /** Move the specular band. Reserve for the award moment. */
  animated?: boolean;
  /** Tier name beside the mark. Owner-only surfaces. */
  showLabel?: boolean;
}) {
  const identity = tierIdentity(plan);
  // Compile once — rebuilding a RuntimeEffect per render is how a cheap shader
  // becomes an expensive one.
  const effect = useMemo(() => Skia.RuntimeEffect.Make(SKSL), []);
  const clock = useClock();

  const w = size * 1.15;
  const metal = identity?.metal;
  const uniforms = useDerivedValue<Uniforms>(() => {
    "worklet";
    return {
      u_resolution: [w, size],
      u_shadow: metal ? rgb(metal.shadow) : [0, 0, 0],
      u_body: metal ? rgb(metal.body) : [0, 0, 0],
      u_highlight: metal ? rgb(metal.highlight) : [0, 0, 0],
      u_sweep: animated ? ((clock.get() % 2400) / 2400) * 1.6 - 0.3 : 0.42,
    };
  }, [metal, w, size, animated]);

  // Free / unknown renders nothing at all.
  if (!identity || !effect) return null;

  const mark = (
    <View
      style={{ width: w, height: size, borderRadius: size / 4, overflow: "hidden" }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${identity.label} member`}
    >
      <Canvas style={{ width: w, height: size }}>
        <Fill>
          <Paint>
            <Shader source={effect} uniforms={uniforms} />
          </Paint>
        </Fill>
      </Canvas>
    </View>
  );

  if (!showLabel) return mark;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      {mark}
      <Text
        style={{
          color: identity.flat,
          fontSize: Math.max(11, size * 0.72),
          fontWeight: "700",
          letterSpacing: 0.3,
        }}
      >
        {identity.label}
      </Text>
    </View>
  );
}
