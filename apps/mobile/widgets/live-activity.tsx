"widget";
/**
 * DVNT event Live Activity (Lock Screen + Dynamic Island) — all-new on
 * expo-widgets `createLiveActivity`. Counts down to doors and reflects host
 * broadcasts (Prompt 7B "starting in 5 min"). SAFE-ONLY: a spicy event arrives
 * already neutralized (state.neutral → "Your event starts soon", no spicy
 * name/art) from buildEventLiveActivityState.
 */
import { createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";
import { activityBackgroundTint, font, foregroundStyle, padding } from "@expo/ui/swift-ui/modifiers";
import { accentColor, DVNT } from "./theme";
import type { LiveWidgetProps } from "./widget-props";
import { Brand, Countdown, Cover, HStack, Muted, Spacer, Text, TierBadge, Title, VStack } from "./ui";

function Banner(props: LiveWidgetProps) {
  const accent = accentColor(props.dominantColor);
  return (
    <HStack spacing={12} modifiers={[padding({ all: 12 }), activityBackgroundTint(DVNT.bg)]}>
      <Cover path={props.imagePath} width={54} height={54} radius={12} accent={accent} />
      <VStack spacing={3} alignment="leading">
        <HStack spacing={6}>
          <Brand size={12} />
          {props.tier ? <TierBadge tier={props.tier} label={props.tier} /> : null}
        </HStack>
        <Title size={16}>{props.eventName}</Title>
        {props.broadcast ? (
          <Text modifiers={[font({ size: 12, weight: "heavy" }), foregroundStyle(accent)]}>
            {props.broadcast}
          </Text>
        ) : props.venueName ? (
          <Muted>{props.venueName}</Muted>
        ) : null}
      </VStack>
      <Spacer />
      <VStack spacing={2} alignment="trailing">
        <Countdown startAt={props.startAt} size={22} color={accent} />
        <Muted size={10}>to doors</Muted>
      </VStack>
    </HStack>
  );
}

function LiveActivityLayout(props: LiveWidgetProps, _env: LiveActivityEnvironment) {
  const accent = accentColor(props.dominantColor);
  return {
    // Lock Screen / Notification banner.
    banner: <Banner {...props} />,
    // Dynamic Island — compact.
    compactLeading: <Brand size={11} />,
    compactTrailing: <Countdown startAt={props.startAt} size={13} color={accent} />,
    minimal: <Countdown startAt={props.startAt} size={12} color={accent} />,
    // Dynamic Island — expanded.
    expandedLeading: (
      <VStack spacing={2} alignment="leading" modifiers={[padding({ leading: 4 })]}>
        <Brand size={12} />
        {props.tier ? <TierBadge tier={props.tier} label={props.tier} /> : null}
      </VStack>
    ),
    expandedTrailing: (
      <VStack spacing={0} alignment="trailing" modifiers={[padding({ trailing: 4 })]}>
        <Countdown startAt={props.startAt} size={20} color={accent} />
        <Muted size={10}>to doors</Muted>
      </VStack>
    ),
    expandedCenter: <Title size={14}>{props.eventName}</Title>,
    expandedBottom: props.broadcast ? (
      <Text modifiers={[font({ size: 12, weight: "heavy" }), foregroundStyle(accent)]}>
        {props.broadcast}
      </Text>
    ) : props.venueName ? (
      <Muted>{props.venueName}</Muted>
    ) : undefined,
  };
}

export const EventLiveActivity = createLiveActivity<LiveWidgetProps>(
  "DVNTEventLive",
  LiveActivityLayout,
);
