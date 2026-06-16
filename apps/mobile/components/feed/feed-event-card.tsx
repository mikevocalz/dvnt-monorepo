/**
 * FeedEventCard — Compact event card shown inline in the feed every N posts.
 *
 * Design: Full-bleed hero image with gradient overlay, category pill,
 * title, venue + time, date badge, and attendee count. Taps navigate
 * to event detail. No scroll-dependent parallax — fully self-contained.
 */
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { DVNTAnimatedVideoView } from "@/components/media/DVNTAnimatedVideoView";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, Clock, Users, Calendar } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCallback, memo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { screenPrefetch } from "@/lib/prefetch";
import type { Event } from "@/lib/hooks/use-events";
import type { PublicGateReason } from "@/lib/access/public-gates";
import { TranslateButton } from "@/components/ui/translate-button";
import { useContentTranslation } from "@/lib/stores/translation-store";
import { shouldShowTranslateButton } from "@/lib/utils/language-detection";

const CARD_HEIGHT = 200;

export const FeedEventCard = memo(function FeedEventCard({
  event,
  guestMode = false,
  onRequireAuth,
}: {
  event: Event;
  guestMode?: boolean;
  onRequireAuth?: (reason: PublicGateReason) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const targetLang = i18n.language;

  // Title translation
  const {
    displayText: translatedTitle,
    isTranslated: isTitleTranslated,
    translate: translateTitleFn,
    showOriginal: showOriginalTitle,
    isCapable: isTranslationCapable,
  } = useContentTranslation(
    `feed-event-${event.id}-title`,
    event.title || "",
    targetLang,
  );

  const showTranslateButton =
    
    shouldShowTranslateButton(event.title || "", targetLang);

  const handleTranslate = useCallback(async () => {
    await translateTitleFn();
  }, [translateTitleFn]);

  const handlePress = useCallback(() => {
    if (guestMode) {
      onRequireAuth?.("events");
      return;
    }
    screenPrefetch.eventDetail(queryClient, event.id);
    router.push(`/(protected)/events/${event.id}` as any);
  }, [event.id, guestMode, onRequireAuth, queryClient, router]);

  const attendeeCount =
    typeof event.attendees === "number"
      ? event.attendees
      : (event.totalAttendees ?? event.attendees?.length ?? 0);

  return (
    <View style={{ paddingHorizontal: 4, paddingVertical: 12 }}>
      <Pressable onPress={handlePress}>
        <View
          style={{
            height: CARD_HEIGHT,
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#111",
          }}
        >
          {/* Hero — video flyer takes priority, falls back to still image */}
          {event.flyerVideoUrl ? (
            <View
              style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                overflow: "hidden",
              }}
            >
              <DVNTAnimatedVideoView
                uri={event.flyerVideoUrl}
                width="100%"
                height="100%"
                contentFit="cover"
                isPlaying
                muted
              />
            </View>
          ) : event.image ? (
            <View
              style={{
                width: "100%",
                height: "100%",
                position: "absolute",
                overflow: "hidden",
              }}
            >
              <Image
                source={{ uri: event.image }}
                style={{ width: "100%", height: "100%", position: "absolute" }}
                contentFit="cover"
              />
            </View>
          ) : null}

          {/* Gradient overlay */}
          <LinearGradient
            colors={[
              "rgba(0,0,0,0.1)",
              "rgba(0,0,0,0.3)",
              "rgba(0,0,0,0.85)",
            ]}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />

          {/* Top row: Category + Date badge */}
          <View
            style={{
              position: "absolute",
              top: 12,
              left: 14,
              right: 14,
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            {(event as any).status === "cancelled" ? (
              // CANCELLED — replaces the category pill. The cancel-event
              // edge function already notified ticket holders + refunded
              // them; this is the visual cue for the rest of the feed.
              <View
                style={{
                  backgroundColor: "rgba(239,68,68,0.85)",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 10,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: "800",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                  }}
                >
                  Cancelled
                </Text>
              </View>
            ) : event.category ? (
              <View
                style={{
                  backgroundColor: "rgba(138,64,207,0.7)",
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 10,
                }}
              >
                <Text
                  style={{
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: "800",
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                  }}
                >
                  {event.category}
                </Text>
              </View>
            ) : (
              <View />
            )}
            {(event.date || event.month) ? (
              <View
                style={{
                  backgroundColor: "rgba(0,0,0,0.6)",
                  borderRadius: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  alignItems: "center",
                  minWidth: 46,
                }}
              >
                {event.date ? (
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 18,
                      fontWeight: "800",
                    }}
                  >
                    {event.date}
                  </Text>
                ) : null}
                {event.month ? (
                  <Text
                    style={{
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 9,
                      fontWeight: "700",
                      textTransform: "uppercase",
                    }}
                  >
                    {event.month}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Bottom content */}
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              paddingHorizontal: 14,
              paddingBottom: 14,
            }}
          >
            {/* Event label */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 4,
                gap: 4,
              }}
            >
              <Calendar size={10} color="rgba(63,220,255,0.9)" />
              <Text
                style={{
                  color: "rgba(63,220,255,0.9)",
                  fontSize: 10,
                  fontWeight: "700",
                  letterSpacing: 1,
                  textTransform: "uppercase",
                }}
              >
                Event
              </Text>
            </View>

            {/* Title + translate button row */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                marginBottom: 6,
                gap: 8,
              }}
            >
              <Text
                numberOfLines={2}
                style={{
                  color: "#fff",
                  fontSize: 18,
                  fontWeight: "800",
                  lineHeight: 22,
                  flex: 1,
                }}
              >
                {translatedTitle || event.title}
              </Text>
              {showTranslateButton && (
                <View style={{ marginTop: 3 }}>
                  <TranslateButton
                    onTranslate={handleTranslate}
                    isTranslated={isTitleTranslated}
                    onToggleOriginal={showOriginalTitle}
                    size="sm"
                  />
                </View>
              )}
            </View>

            {/* Meta row: venue, time, attendees */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              {event.location ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <MapPin size={10} color="rgba(255,255,255,0.5)" />
                  <Text
                    numberOfLines={1}
                    style={{
                      color: "rgba(255,255,255,0.7)",
                      fontSize: 11,
                      maxWidth: 140,
                    }}
                  >
                    {event.location}
                  </Text>
                </View>
              ) : null}
              {event.time ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Clock size={10} color="rgba(255,255,255,0.5)" />
                  <Text
                    style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}
                  >
                    {event.time}
                  </Text>
                </View>
              ) : null}
              {attendeeCount > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                  }}
                >
                  <Users size={10} color="rgba(255,255,255,0.5)" />
                  <Text
                    style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}
                  >
                    {attendeeCount}
                  </Text>
                </View>
              ) : null}
              {event.price != null && event.price > 0 ? (
                <View
                  style={{
                    backgroundColor: "rgba(138,64,207,0.4)",
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 8,
                  }}
                >
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: "700",
                    }}
                  >
                    ${event.price}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    </View>
  );
});
