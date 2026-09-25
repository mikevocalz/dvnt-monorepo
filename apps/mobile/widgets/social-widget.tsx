"widget";
/**
 * DVNT Social widget — activity glance (unread count) + carousel of recent safe
 * activity / new followers with avatars and tier badges. SAFE-ONLY and OWN-DATA
 * ONLY: spicy/age-gated activity and anything that would leak another user's
 * private content is filtered at the write layer; these props are pre-sanitized.
 */
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import { containerBackground, font, foregroundStyle, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { DVNT } from "./theme";
import type { SocialCard, SocialWidgetProps } from "./widget-props";
import { Brand, BrandedState, Cover, HStack, Muted, Spacer, Text, TierBadge, Title, VStack } from "./ui";

const clampIndex = (len: number, i: number) => (len ? ((i % len) + len) % len : 0);

function root(children: React.ReactNode, deepLink = "dvnt://activity") {
  return (
    <VStack
      spacing={6}
      modifiers={[containerBackground(DVNT.bg, "widget"), padding({ all: 12 }), widgetURL(deepLink)]}
    >
      {children}
    </VStack>
  );
}

function ActivityRow({ card }: { card: SocialCard }) {
  return (
    <HStack spacing={10} modifiers={[widgetURL(card.deepLink)]}>
      <Cover path={card.avatarUrl ? card.imagePath : null} width={38} height={38} radius={19} accent={DVNT.bgElevated} />
      <VStack spacing={2} alignment="leading">
        <Title size={13}>{card.title}</Title>
        {card.tier ? <TierBadge tier={card.tier} label={card.tier} /> : null}
      </VStack>
      <Spacer />
    </HStack>
  );
}

function UnreadPill({ count }: { count: number }) {
  return (
    <Text
      modifiers={[
        font({ size: 12, weight: "heavy" }),
        foregroundStyle("#05060B"),
        padding({ top: 2, bottom: 2, leading: 9, trailing: 9 }),
        // accent handled by background in ui via TierBadge pattern; keep simple here
      ]}
    >
      {count > 99 ? "99+" : String(count)}
    </Text>
  );
}

function Small({ cards, unreadCount }: { cards: SocialCard[]; unreadCount: number }) {
  const top = cards[0];
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={13} />
        <Spacer />
        {unreadCount > 0 ? <UnreadPill count={unreadCount} /> : null}
      </HStack>
      <Spacer />
      {top ? (
        <>
          <Cover path={top.imagePath} width={44} height={44} radius={22} accent={DVNT.bgElevated} />
          <Title size={14}>{top.title}</Title>
        </>
      ) : (
        <Muted>No new activity</Muted>
      )}
    </>,
  );
}

function List({ cards, unreadCount, limit }: { cards: SocialCard[]; unreadCount: number; limit: number }) {
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={15} />
        <Spacer />
        {unreadCount > 0 ? <Muted size={11}>{`${unreadCount} new`}</Muted> : null}
      </HStack>
      <VStack spacing={10} alignment="leading" modifiers={[padding({ top: 2 })]}>
        {cards.slice(0, limit).map((c) => (
          <ActivityRow key={c.id} card={c} />
        ))}
      </VStack>
    </>,
  );
}

function SocialLayout(props: SocialWidgetProps, env: WidgetEnvironment) {
  const cards = props.cards ?? [];
  const unread = props.unreadCount ?? 0;
  if (!cards.length && unread === 0) {
    return root(<BrandedState headline="You're all caught up" sub="Open DVNT" />);
  }
  if (env.widgetFamily === "systemSmall") return <Small cards={cards} unreadCount={unread} />;
  const limit = env.widgetFamily === "systemLarge" ? 5 : 2;
  void clampIndex;
  return <List cards={cards} unreadCount={unread} limit={limit} />;
}

export const SocialWidget = createWidget<SocialWidgetProps>("DVNTSocial", SocialLayout);
