"widget";
/**
 * DVNT Blog widget — latest post + carousel of recent posts (timeline-driven),
 * cover with dominant-color accent, title, author, read-time. SAFE-ONLY: spicy /
 * mature posts are filtered at the write layer, never reaching these props.
 */
import { createWidget, type WidgetEnvironment } from "expo-widgets";
import { containerBackground, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { accentColor, DVNT } from "./theme";
import type { BlogCard, BlogWidgetProps } from "./widget-props";
import { Brand, BrandedState, Cover, HStack, Muted, Spacer, Title, VStack } from "./ui";

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

function meta(card: BlogCard): string {
  return [card.authorName, card.readTimeMins ? `${card.readTimeMins} min` : null]
    .filter(Boolean)
    .join(" · ");
}

function PostRow({ card }: { card: BlogCard }) {
  return (
    <HStack spacing={10} modifiers={[widgetURL(card.deepLink)]}>
      <Cover path={card.imagePath} width={44} height={44} radius={8} accent={accentColor(card.dominantColor)} />
      <VStack spacing={2} alignment="leading">
        <Title size={13}>{card.title}</Title>
        <Muted size={11}>{meta(card)}</Muted>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function Small({ card }: { card: BlogCard }) {
  return root(
    <>
      <Brand size={13} />
      <Spacer />
      <Cover path={card.imagePath} width={120} height={70} radius={10} accent={accentColor(card.dominantColor)} />
      <Title size={14}>{card.title}</Title>
      {card.readTimeMins ? <Muted size={11}>{`${card.readTimeMins} min read`}</Muted> : null}
    </>,
    card.deepLink,
  );
}

function Medium({ card, index, total }: { card: BlogCard; index: number; total: number }) {
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={13} />
        <Spacer />
        {total > 1 ? <Muted size={11}>{`${index + 1} of ${total}`}</Muted> : null}
      </HStack>
      <Spacer />
      <HStack spacing={12}>
        <Cover path={card.imagePath} width={96} height={96} radius={12} accent={accentColor(card.dominantColor)} />
        <VStack spacing={4} alignment="leading">
          <Title size={17}>{card.title}</Title>
          <Muted>{meta(card)}</Muted>
        </VStack>
        <Spacer />
      </HStack>
    </>,
    card.deepLink,
  );
}

function Large({ cards, index }: { cards: BlogCard[]; index: number }) {
  const featured = cards[index];
  const rest = cards.filter((_, i) => i !== index).slice(0, 3);
  return root(
    <>
      <HStack spacing={6}>
        <Brand size={16} />
        <Spacer />
        <Muted size={11}>Latest stories</Muted>
      </HStack>
      <Cover path={featured.imagePath} width={9999} height={132} radius={14} accent={accentColor(featured.dominantColor)} />
      <Title size={19}>{featured.title}</Title>
      <Muted>{meta(featured)}</Muted>
      {rest.length ? (
        <VStack spacing={8} modifiers={[padding({ top: 4 })]}>
          {rest.map((c) => (
            <PostRow key={c.slug} card={c} />
          ))}
        </VStack>
      ) : null}
    </>,
    featured.deepLink,
  );
}

function BlogLayout(props: BlogWidgetProps, env: WidgetEnvironment) {
  const cards = props.cards ?? [];
  if (!cards.length) {
    return root(<BrandedState headline="No stories yet" sub="Check back soon" />);
  }
  const index = clampIndex(cards.length, props.index);
  if (env.widgetFamily === "systemSmall") return <Small card={cards[index]} />;
  if (env.widgetFamily === "systemLarge") return <Large cards={cards} index={index} />;
  return <Medium card={cards[index]} index={index} total={cards.length} />;
}

export const BlogWidget = createWidget<BlogWidgetProps>("DVNTBlog", BlogLayout);
