/**
 * EventCollectionRow — horizontal scrollable row of mini event cards
 * Used for curated collections on the events home screen.
 */

import { View, Text, Pressable, ScrollView } from "react-native";
import { Image } from "expo-image";
import { DVNTAnimatedVideoView } from "@/components/media/DVNTAnimatedVideoView";
import { useRouter } from "expo-router";
import { useColorScheme } from "@/lib/hooks";
import { MapPin, Calendar } from "lucide-react-native";
import type { Event } from "@/lib/hooks/use-events";

const CARD_WIDTH = 200;

interface EventCollectionRowProps {
  title: string;
  emoji?: string;
  events: Event[];
  maxItems?: number;
}

export function EventCollectionRow({
  title,
  emoji,
  events,
  maxItems = 8,
}: EventCollectionRowProps) {
  const router = useRouter();
  const { colors } = useColorScheme();

  if (events.length === 0) return null;

  const items = events.slice(0, maxItems);

  return (
    <View className="mb-5">
      <View className="flex-row items-center gap-2 px-4 mb-3">
        {emoji && <Text style={{ fontSize: 16 }}>{emoji}</Text>}
        <Text className="text-base font-bold text-foreground">{title}</Text>
        <Text className="text-xs text-muted-foreground ml-1">
          {events.length}
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      >
        {items.map((event) => (
          <Pressable
            key={event.id}
            onPress={() =>
              router.push(`/(protected)/events/${event.id}` as any)
            }
            style={{ width: CARD_WIDTH }}
            className="bg-card rounded-2xl overflow-hidden border border-border"
          >
            {event.flyerVideoUrl ? (
              <DVNTAnimatedVideoView
                uri={event.flyerVideoUrl}
                width={CARD_WIDTH}
                height={120}
                style={{ width: CARD_WIDTH, height: 120 }}
                contentFit="cover"
                muted
              />
            ) : (
              <Image
                source={{ uri: event.image }}
                style={{ width: CARD_WIDTH, height: 120 }}
                contentFit="cover"
              />
            )}
            <View className="p-3 gap-1.5">
              <Text
                className="text-sm font-semibold text-foreground"
                numberOfLines={1}
              >
                {event.title}
              </Text>
              <View className="flex-row items-center gap-1.5">
                <Calendar size={11} color={colors.mutedForeground} />
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={1}
                >
                  {event.date}
                </Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <MapPin size={11} color={colors.mutedForeground} />
                <Text
                  className="text-xs text-muted-foreground"
                  numberOfLines={1}
                >
                  {event.location}
                </Text>
              </View>
              {event.price > 0 && (
                <Text className="text-xs font-bold text-primary">
                  ${event.price}
                </Text>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
