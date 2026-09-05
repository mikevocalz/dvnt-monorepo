/**
 * Ambient paint-light field (web tier).
 *
 * A purple/magenta radial glow that drifts toward the cursor — the universal,
 * always-safe tier. We intentionally don't gamble the first web render on
 * Skia-on-web (CanvasKit + the shimmed expo-modules-core are unproven here);
 * native gets the Skia RuntimeEffect instead (AmbientField.native.tsx).
 *
 * Drift runs on GSAP quickTo (same engine as the other web sections), NOT
 * Reanimated: its web mappers kept animating after unmount and crashed against
 * detached view descriptors (DVNT-WEB-6). killTweensOf on cleanup guarantees
 * nothing outlives the component. Reduce-motion freezes the drift.
 */
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { gsap, prefersReducedMotion } from "../hooks/useGsap";
import { LANDING_GRADIENTS } from "../theme";

export function AmbientField() {
  const driftRef = useRef<View>(null);

  useEffect(() => {
    // RNW forwards the ref to the host DOM node.
    const el = driftRef.current as unknown as HTMLElement | null;
    if (!el || typeof window === "undefined" || prefersReducedMotion()) return;

    // Matches the previous timeline: pointer 0..1 → ±70px / ±50px, eased over
    // 600ms so the light "follows" rather than snaps. Rest pose (0.5, 0.4) is
    // baked into styles.primary as translateY(-10).
    const xTo = gsap.quickTo(el, "x", { duration: 0.6, ease: "power2.out" });
    const yTo = gsap.quickTo(el, "y", { duration: 0.6, ease: "power2.out" });
    const onMove = (e: PointerEvent) => {
      xTo((e.clientX / window.innerWidth) * 140 - 70);
      yTo((e.clientY / window.innerHeight) * 100 - 50);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      gsap.killTweensOf(el);
    };
  }, []);

  return (
    <View style={styles.fill} pointerEvents="none">
      <View ref={driftRef} style={[styles.layer, styles.primary]} />
      <View style={[styles.layer, styles.secondary]} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    // `fixed` (web) pins the glow to the viewport. As `absolute` it stretched
    // to the full page scroll-height, so scrolling forced the browser to
    // re-rasterize fresh regions of a huge radial gradient — which is what made
    // the background appear to "load in late" while scrolling.
    position: "fixed" as "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
  },
  layer: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  primary: {
    // Rest pose of the old pointer field: (tx 0.5, ty 0.4) → (0px, -10px).
    transform: [{ translateY: -10 }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({ backgroundImage: LANDING_GRADIENTS.ambientCss } as any) as object),
  },
  secondary: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(({
      backgroundImage:
        "radial-gradient(40% 40% at 80% 80%, rgba(63,220,255,0.12) 0%, rgba(2,3,10,0) 70%)",
    } as any) as object),
  },
});
