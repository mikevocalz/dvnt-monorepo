/**
 * Ambient paint-light field (native tier) — Skia RuntimeEffect (SkSL).
 *
 * A purple→magenta light field whose glow tracks the pointer/touch via
 * shared-value uniforms, animated by the Skia clock. Falls back to a flat
 * gradient Fill if the shader fails to compile. Reduce-motion holds time still.
 */
import { useMemo } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import {
  Canvas,
  Fill,
  LinearGradient,
  Shader,
  Skia,
  useClock,
  vec,
} from "@shopify/react-native-skia";
import { useDerivedValue } from "react-native-reanimated";
import { useLandingScroll } from "../hooks/useScrollProgress";
import { usePointerField } from "../hooks/usePointerField";
import { LANDING_COLORS } from "../theme";

const SOURCE = Skia.RuntimeEffect.Make(`
uniform float2 u_resolution;
uniform float  u_time;
uniform float2 u_pointer;

half4 main(float2 fragCoord) {
  float2 uv = fragCoord / u_resolution;
  float d = distance(uv, u_pointer);
  float glow = smoothstep(0.65, 0.0, d);
  float3 purple  = float3(0.541, 0.251, 0.812);
  float3 magenta = float3(1.0,   0.357, 0.988);
  float3 col = mix(purple, magenta, uv.y) * glow;
  col += 0.03 * sin(u_time * 0.6 + uv.x * 10.0);
  return half4(col * 0.55, 1.0);
}`);

export function AmbientField() {
  const { width, height } = useWindowDimensions();
  const { reduceMotion } = useLandingScroll();
  const pointer = usePointerField();
  const clock = useClock();

  const uniforms = useDerivedValue(
    () => ({
      u_resolution: [width, height],
      u_time: reduceMotion.value ? 0 : clock.value / 1000,
      u_pointer: [pointer.x.value, pointer.y.value],
    }),
    [width, height, reduceMotion, clock, pointer.x, pointer.y],
  );

  const canShade = useMemo(() => SOURCE != null, []);

  return (
    <View style={styles.fill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Fill>
          {canShade ? (
            <Shader source={SOURCE!} uniforms={uniforms} />
          ) : (
            <LinearGradient
              start={vec(0, 0)}
              end={vec(width, height)}
              colors={[LANDING_COLORS.purple, LANDING_COLORS.bg]}
            />
          )}
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
});
