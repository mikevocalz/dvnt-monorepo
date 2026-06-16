/**
 * SpotlightCarousel — Promoted events horizontal pager.
 *
 * Design: tall poster-style cards (portrait), scroll-driven dots in DVNT colors.
 */

import React, { useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  useWindowDimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  type SharedValue,
} from "react-native-reanimated";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Zap, MapPin, Calendar } from "lucide-react-native";
import { useRouter } from "expo-router";
import type { SpotlightItem } from "@/src/events/promotion-types";

// DVNT brand gradient stops for the dots
const DVNT_DOT_COLORS = ["#8A40CF", "#3FDCFF", "#FF5BFC", "#f59e0b"];

// ── Spotlight Card (Poster) ──────────────────────────────────────────────────

function SpotlightCard({
  item,
  cardWidth,
  cardHeight,
}: {
  item: SpotlightItem;
  cardWidth: number;
  cardHeight: number;
}) {
  const router = useRouter();

  return (
    <Pressable
      onPress={() =>
        router.push(`/(protected)/events/${item.event_id}` as any)
      }
      style={{ width: cardWidth, marginHorizontal: 6 }}
    >
      <View
        style={{
          width: cardWidth,
          height: cardHeight,
          borderRadius: 20,
          overflow: "hidden",
          backgroundColor: "#1a1a1a",
        }}
      >
        {/* Poster image — fills full height */}
        <Image
          source={{ uri: item.spotlight_image || item.cover_image }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />

        {/* Deep gradient from bottom */}
        <LinearGradient
          colors={[
            "transparent",
            "rgba(0,0,0,0.1)",
            "rgba(0,0,0,0.55)",
            "rgba(0,0,0,0.9)",
          ]}
          locations={[0.25, 0.5, 0.72, 1]}
          style={{
            position: "absolute",
            inset: 0,
            justifyContent: "flex-end",
            padding: 16,
          }}
        >
          {/* Badges row */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <View
              style={{
                backgroundColor: "rgba(138,64,207,0.85)",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: "rgba(138,64,207,0.5)",
              }}
            >
              <Zap size={10} color="#fff" fill="#fff" />
              <Text
                style={{
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: "800",
                  letterSpacing: 0.5,
                }}
              >
                SPOTLIGHT
              </Text>
            </View>
            {item.category && (
              <View
                style={{
                  backgroundColor: "rgba(255,255,255,0.12)",
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.15)",
                }}
              >
                <Text
                  style={{ color: "rgba(255,255,255,0.9)", fontSize: 10, fontWeight: "600" }}
                >
                  {item.category}
                </Text>
              </View>
            )}
          </View>

          {/* Event title */}
          <Text
            style={{
              color: "#fff",
              fontSize: 20,
              fontWeight: "800",
              lineHeight: 24,
              marginBottom: 8,
              letterSpacing: -0.3,
            }}
            numberOfLines={2}
          >
            {item.title}
          </Text>

          {/* Location + price row */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <MapPin size={12} color="rgba(63,220,255,0.8)" />
            <Text
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 12,
                flex: 1,
              }}
              numberOfLines={1}
            >
              {item.location}
            </Text>
            {item.price != null && (
              <View
                style={{
                  backgroundColor: item.price === 0
                    ? "rgba(34,197,94,0.2)"
                    : "rgba(138,64,207,0.25)",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: item.price === 0
                    ? "rgba(34,197,94,0.4)"
                    : "rgba(138,64,207,0.4)",
                }}
              >
                <Text
                  style={{
                    color: item.price === 0 ? "#22C55E" : "#C084FC",
                    fontSize: 12,
                    fontWeight: "800",
                  }}
                >
                  {item.price === 0 ? "FREE" : `$${item.price}`}
                </Text>
              </View>
            )}
          </View>
        </LinearGradient>
      </View>
    </Pressable>
  );
}

// ── Animated Dot (DVNT colors) ───────────────────────────────────────────────

function AnimatedDot({
  index,
  scrollX,
  itemWidth,
  dotColor,
}: {
  index: number;
  scrollX: SharedValue<number>;
  itemWidth: number;
  dotColor: string;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const input = itemWidth > 0 ? scrollX.value / itemWidth : 0;
    const width = interpolate(
      input,
      [index - 1, index, index + 1],
      [5, 20, 5],
      "clamp",
    );
    const opacity = interpolate(
      input,
      [index - 1, index, index + 1],
      [0.25, 1, 0.25],
      "clamp",
    );
    return { width, opacity };
  });

  return (
    <Animated.View
      style={[
        {
          height: 5,
          borderRadius: 3,
          backgroundColor: dotColor,
        },
        animatedStyle,
      ]}
    />
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function SpotlightSection({ items }: { items: SpotlightItem[] }) {
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<Animated.ScrollView>(null);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUserScrollingRef = useRef(false);
  const activeIndexRef = useRef(0);

  // Poster proportions: ~9:14 (like a movie poster)
  const CARD_WIDTH = screenWidth - 80;
  const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.4);
  const ITEM_WIDTH = CARD_WIDTH + 12;
  const PADDING = (screenWidth - CARD_WIDTH) / 2 - 6;

  const scrollX = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollX.value = e.contentOffset.x;
    },
  });

  useEffect(() => {
    activeIndexRef.current = 0;
    scrollX.value = 0;
    scrollRef.current?.scrollTo({ x: 0, animated: false });
  }, []);

  const startAutoScroll = useCallback(() => {
    if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
    autoScrollTimer.current = setInterval(() => {
      if (isUserScrollingRef.current) return;
      const next = (activeIndexRef.current + 1) % items.length;
      activeIndexRef.current = next;
      scrollRef.current?.scrollTo({
        x: next * ITEM_WIDTH,
        animated: true,
      });
    }, 4500);
  }, [items.length, ITEM_WIDTH]);

  useEffect(() => {
    if (items.length > 1) startAutoScroll();
    return () => {
      if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
    };
  }, [items.length, startAutoScroll]);

  const handleScrollBegin = useCallback(() => {
    isUserScrollingRef.current = true;
    if (autoScrollTimer.current) clearInterval(autoScrollTimer.current);
  }, []);

  const handleScrollEnd = useCallback(
    (e: any) => {
      isUserScrollingRef.current = false;
      const offsetX = e.nativeEvent.contentOffset.x;
      const idx = Math.max(
        0,
        Math.min(Math.round(offsetX / ITEM_WIDTH), items.length - 1),
      );
      activeIndexRef.current = idx;
      if (items.length > 1) startAutoScroll();
    },
    [items.length, ITEM_WIDTH, startAutoScroll],
  );

  if (items.length === 0) return null;

  return (
    <View style={{ paddingTop: 12, paddingBottom: 8 }}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 16,
          marginBottom: 12,
        }}
      >
        <Zap size={16} color="#8A40CF" fill="#8A40CF" />
        <Text style={{ color: "#fff", fontSize: 20, fontFamily: "Republica-Minor", letterSpacing: 0.5 }}>
          Spotlight
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.35)", fontSize: 13 }}>
          · Promoted
        </Text>
      </View>

      {/* Poster cards */}
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToInterval={ITEM_WIDTH}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        scrollEnabled={items.length > 1}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: PADDING }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={handleScrollBegin}
        onMomentumScrollEnd={handleScrollEnd}
      >
        {items.map((item) => (
          <SpotlightCard
            key={item.campaign_id}
            item={item}
            cardWidth={CARD_WIDTH}
            cardHeight={CARD_HEIGHT}
          />
        ))}
      </Animated.ScrollView>

      {/* DVNT-colored scroll-driven dots */}
      {items.length > 1 && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            marginTop: 14,
          }}
        >
          {Array.from({ length: Math.min(items.length, 8) }).map((_, i) => (
            <AnimatedDot
              key={i}
              index={i}
              scrollX={scrollX}
              itemWidth={ITEM_WIDTH}
              dotColor={DVNT_DOT_COLORS[i % DVNT_DOT_COLORS.length]}
            />
          ))}
        </View>
      )}
    </View>
  );
}
