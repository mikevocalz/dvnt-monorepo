/**
 * EventShareBubble — rich event card rendered inside a chat message.
 *
 * Tapping navigates to the event detail screen.
 * Matches the visual language of SharedPostBubble.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { CalendarDays, MapPin, Ticket } from "lucide-react-native";
import type { EventShareContext } from "@dvnt/app/lib/stores/chat-store";

interface EventShareBubbleProps {
  eventShare: EventShareContext;
  isOwnMessage: boolean;
}

function formatEventDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function EventShareBubble({
  eventShare,
  isOwnMessage,
}: EventShareBubbleProps) {
  const router = useRouter();

  const handlePress = () => {
    if (eventShare.eventId) {
      router.push(`/(protected)/events/${eventShare.eventId}` as any);
    }
  };

  const formattedDate = formatEventDate(eventShare.eventDate);

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [styles.container, pressed && { opacity: 0.88 }]}
    >
      {/* Cover image */}
      {eventShare.eventImage ? (
        <Image
          source={{ uri: eventShare.eventImage }}
          style={styles.cover}
          contentFit="cover"
          transition={200}
          cachePolicy="memory-disk"
          recyclingKey={eventShare.eventImage}
        />
      ) : (
        <View style={[styles.cover, styles.coverFallback]}>
          <Ticket size={32} color="rgba(255,255,255,0.25)" />
        </View>
      )}

      {/* Event info */}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {eventShare.eventTitle}
        </Text>

        {formattedDate ? (
          <View style={styles.metaRow}>
            <CalendarDays size={12} color="rgba(255,255,255,0.5)" />
            <Text style={styles.metaText}>{formattedDate}</Text>
          </View>
        ) : null}

        {eventShare.eventLocation ? (
          <View style={styles.metaRow}>
            <MapPin size={12} color="rgba(255,255,255,0.5)" />
            <Text style={styles.metaText} numberOfLines={1}>
              {eventShare.eventLocation}
            </Text>
          </View>
        ) : null}
      </View>

      {/* CTA */}
      <View style={styles.cta}>
        <Text style={styles.ctaText}>View Event</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 240,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.12)",
  },
  cover: {
    width: "100%",
    height: 130,
  },
  coverFallback: {
    backgroundColor: "rgba(63,220,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 4,
  },
  title: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  metaText: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    flex: 1,
  },
  cta: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingVertical: 9,
    alignItems: "center",
  },
  ctaText: {
    color: "#3FDCFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
