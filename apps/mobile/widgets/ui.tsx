"widget";
/**
 * Shared DVNT widget UI primitives (SwiftUI via @expo/ui). Rendered inside the
 * widget extension process, so this file carries the "widget" directive and
 * imports only TYPES from the app. Brand on every family, glass + gradient per
 * docs/dvnt-design-system.md, motion via live countdowns / progress rings.
 */
import { HStack, Image, Spacer, Text, VStack, ZStack, Gauge } from "@expo/ui/swift-ui";
import {
  background,
  clipShape,
  cornerRadius,
  font,
  foregroundStyle,
  frame,
  glassEffect,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { WidgetTierLevel } from "@dvnt/app/lib/widgets";
import { DISPLAY_FONT, DVNT, DVNT_GRADIENT, TIER_ACCENT } from "./theme";

/** The teal→purple gradient fill for the wordmark. */
const wordmarkGradient = foregroundStyle({
  type: "linearGradient",
  colors: [...DVNT_GRADIENT],
  startPoint: { x: 0, y: 0 },
  endPoint: { x: 1, y: 1 },
});

/** Gradient wordmark (large families) or compact glyph (small). */
export function Brand({ size = 18 }: { size?: number }) {
  return (
    <Text modifiers={[font({ family: DISPLAY_FONT, size, weight: "black" }), wordmarkGradient]}>
      DVNT
    </Text>
  );
}

export function TierBadge({ tier, label }: { tier: WidgetTierLevel; label: string }) {
  const accent = TIER_ACCENT[tier] ?? DVNT.cyan;
  return (
    <Text
      modifiers={[
        font({ size: 10, weight: "heavy" }),
        foregroundStyle("#05060B"),
        padding({ top: 2, bottom: 2, leading: 7, trailing: 7 }),
        background(accent, shapes.capsule()),
      ]}
    >
      {label.toUpperCase()}
    </Text>
  );
}

/** Live countdown ticker (motion within constraints). Shows LIVE once started. */
export function Countdown({
  startAt,
  size = 15,
  color = DVNT.text,
}: {
  startAt: string | null;
  size?: number;
  color?: string;
}) {
  const upper = startAt ? new Date(startAt) : null;
  const now = new Date();
  if (!upper || upper.getTime() <= now.getTime()) {
    return (
      <Text modifiers={[font({ size, weight: "heavy" }), foregroundStyle(DVNT.magenta)]}>
        LIVE
      </Text>
    );
  }
  return (
    <Text
      timerInterval={{ lower: now, upper }}
      countsDown
      modifiers={[font({ size, weight: "heavy" }), foregroundStyle(color)]}
    />
  );
}

/** Progress ring for "time to doors" (fills over the final 24h). */
export function DoorsGauge({ startAt, accent }: { startAt: string | null; accent: string }) {
  const window = 24 * 60 * 60 * 1000;
  let value = 1;
  if (startAt) {
    const remaining = new Date(startAt).getTime() - Date.now();
    value = Math.max(0, Math.min(1, 1 - remaining / window));
  }
  return (
    <Gauge
      value={value}
      min={0}
      max={1}
      modifiers={[foregroundStyle(accent), frame({ width: 34, height: 34 })]}
    >
      <Image systemName="ticket.fill" size={12} color={accent} />
    </Gauge>
  );
}

/** Local cached image, or a branded gradient placeholder when none is cached. */
export function Cover({
  path,
  width,
  height,
  radius = 12,
  accent = DVNT.bgElevated,
}: {
  path?: string | null;
  width: number;
  height: number;
  radius?: number;
  accent?: string;
}) {
  if (path) {
    return (
      <Image
        uiImage={path}
        modifiers={[frame({ width, height }), cornerRadius(radius), clipShape("roundedRectangle", radius)]}
      />
    );
  }
  return (
    <ZStack
      modifiers={[
        frame({ width, height }),
        background(accent, shapes.roundedRectangle({ cornerRadius: radius })),
        cornerRadius(radius),
      ]}
    >
      <Text modifiers={[font({ family: DISPLAY_FONT, size: 13, weight: "black" }), foregroundStyle("rgba(250,250,249,0.45)")]}>
        DVNT
      </Text>
    </ZStack>
  );
}

/** A rounded glass card wrapper. */
export function GlassCard({
  children,
  radius = 16,
}: {
  children: React.ReactNode;
  radius?: number;
}) {
  return (
    <VStack
      spacing={0}
      modifiers={[
        padding({ all: 12 }),
        glassEffect({ glass: { variant: "regular" }, shape: "roundedRectangle", cornerRadius: radius }),
        cornerRadius(radius),
      ]}
    >
      {children}
    </VStack>
  );
}

export function Muted({ children, size = 12 }: { children: React.ReactNode; size?: number }) {
  return (
    <Text modifiers={[font({ size }), foregroundStyle(DVNT.textSecondary)]}>{children}</Text>
  );
}

export function Title({
  children,
  size = 16,
  lines,
}: {
  children: React.ReactNode;
  size?: number;
  lines?: number;
}) {
  void lines;
  return (
    <Text modifiers={[font({ size, weight: "bold" }), foregroundStyle(DVNT.text)]}>{children}</Text>
  );
}

/** Neutral, branded state used for empties and the spicy-suppressed ticket case. */
export function BrandedState({ headline, sub }: { headline: string; sub?: string }) {
  return (
    <VStack spacing={6} modifiers={[frame({ maxWidth: 9999, alignment: "center" }), padding({ all: 14 })]}>
      <Brand size={22} />
      <Text modifiers={[font({ size: 14, weight: "semibold" }), foregroundStyle(DVNT.text)]}>
        {headline}
      </Text>
      {sub ? <Muted>{sub}</Muted> : null}
    </VStack>
  );
}

export { HStack, Spacer, Text, VStack, ZStack };
