"widget";
/**
 * DVNT Tickets widget — next ticket + carousel of upcoming tickets, live door
 * countdown, tier badge, flyer with dominant-color accent. Lock Screen accessory
 * families supported. Carousel = timeline: the app schedules entries with an
 * advancing `index` (see backend.ts) so the card visibly cycles.
 *
 * SAFE-ONLY: props already exclude spicy events (filtered at the write layer).
 * `suppressed` (only-spicy tickets) → neutral branded state.
 */
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import { containerBackground, foregroundStyle, font, frame, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { accentColor, DVNT } from "./theme";
import type { TicketCard, TicketsWidgetProps } from "./widget-props";
import {
  Brand,
  BrandedState,
  Countdown,
  Cover,
  DoorsGauge,
  HStack,
  Muted,
  Spacer,
  Text,
  TierBadge,
  Title,
  VStack,
} from "./ui";

const clampIndex = (len: number, i: number) => (len ? ((i % len) + len) % len : 0);

function root(children: React.ReactNode, deepLink?: string) {
  const mods = [containerBackground(DVNT.bg, "widget"), padding({ all: 12 })];
  if (deepLink) mods.push(widgetURL(deepLink));
  return (
    <VStack spacing={6} modifiers={mods}>
      {children}
    </VStack>
  );
}

function AccessoryGlance({ card }: { card: TicketCard | null }) {
  if (!card) {
    return (
      <Text modifiers={[font({ size: 12, weight: "semibold" }), foregroundStyle(DVNT.text)]}>
        DVNT · no tickets
      </Text>
    );
  }
  return (
    <VStack spacing={1} modifiers={[widgetURL(card.deepLink)]}>
      <Text modifiers={[font({ size: 12, weight: "heavy" }), foregroundStyle(DVNT.text)]}>
        {card.eventName}
      </Text>
      <Countdown startAt={card.startAt} size={12} color={DVNT.cyan} />
    </VStack>
  );
}

function TicketRow({ card }: { card: TicketCard }) {
  const accent = accentColor(card.dominantColor);
  return (
    <HStack spacing={10} modifiers={[widgetURL(card.deepLink)]}>
      <Cover path={card.imagePath} width={46} height={46} radius={10} accent={accent} />
      <VStack spacing={2} alignment="leading">
        <Title size={14}>{card.eventName}</Title>
        <HStack spacing={6}>
          <TierBadge tier={card.tier} label={card.tierLabel} />
          <Countdown startAt={card.startAt} size={12} color={accent} />
        </HStack>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function Small({ card }: { card: TicketCard }) {
  const accent = accentColor(card.dominantColor);
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={13} />
        <Spacer />
        <TierBadge tier={card.tier} label={card.tierLabel} />
      </HStack>
      <Spacer />
      <Cover path={card.imagePath} width={120} height={64} radius={10} accent={accent} />
      <Title size={15}>{card.eventName}</Title>
      <HStack spacing={8}>
        <Countdown startAt={card.startAt} size={20} color={accent} />
        <Spacer />
        <DoorsGauge startAt={card.startAt} accent={accent} />
      </HStack>
    </>,
    card.deepLink,
  );
}

function Medium({ card, index, total }: { card: TicketCard; index: number; total: number }) {
  const accent = accentColor(card.dominantColor);
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={13} />
        <Spacer />
        {total > 1 ? <Muted size={11}>{`${index + 1} of ${total}`}</Muted> : null}
      </HStack>
      <Spacer />
      <HStack spacing={12}>
        <Cover path={card.imagePath} width={92} height={92} radius={12} accent={accent} />
        <VStack spacing={4} alignment="leading">
          <Title size={17}>{card.eventName}</Title>
          {card.venueName ? <Muted>{card.venueName}</Muted> : null}
          <TierBadge tier={card.tier} label={card.tierLabel} />
          <HStack spacing={8}>
            <Countdown startAt={card.startAt} size={18} color={accent} />
            <DoorsGauge startAt={card.startAt} accent={accent} />
          </HStack>
        </VStack>
        <Spacer />
      </HStack>
    </>,
    card.deepLink,
  );
}

function Large({ cards, index }: { cards: TicketCard[]; index: number }) {
  const featured = cards[index];
  const accent = accentColor(featured.dominantColor);
  const rest = cards.filter((_, i) => i !== index).slice(0, 3);
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={16} />
        <Spacer />
        <Muted size={11}>{`${cards.length} upcoming`}</Muted>
      </HStack>
      <Cover path={featured.imagePath} width={9999} height={128} radius={14} accent={accent} />
      <Title size={19}>{featured.eventName}</Title>
      <HStack spacing={8}>
        <TierBadge tier={featured.tier} label={featured.tierLabel} />
        <Countdown startAt={featured.startAt} size={18} color={accent} />
        <Spacer />
        <DoorsGauge startAt={featured.startAt} accent={accent} />
      </HStack>
      {rest.length ? (
        <VStack spacing={8} modifiers={[padding({ top: 4 })]}>
          {rest.map((c) => (
            <TicketRow key={c.ticketId} card={c} />
          ))}
        </VStack>
      ) : null}
    </>,
    featured.deepLink,
  );
}

function TicketsLayout(props: TicketsWidgetProps, env: WidgetEnvironment) {
  const cards = props.cards ?? [];
  const family = env.widgetFamily;

  if (family.startsWith("accessory")) {
    return root(<AccessoryGlance card={cards[clampIndex(cards.length, props.index)] ?? null} />);
  }
  if (props.suppressed) {
    return root(<BrandedState headline="You've got plans 👀" sub="Open DVNT" />);
  }
  if (!cards.length) {
    return root(<BrandedState headline="No upcoming tickets" sub="Find tonight's move" />);
  }

  const index = clampIndex(cards.length, props.index);
  if (family === "systemSmall") return <Small card={cards[index]} />;
  if (family === "systemLarge") return <Large cards={cards} index={index} />;
  return <Medium card={cards[index]} index={index} total={cards.length} />;
}

export const TicketsWidget = createWidget<TicketsWidgetProps>("DVNTTickets", TicketsLayout);
