import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { DVNTAnimatedVideoView } from "@dvnt/app/components/media/DVNTAnimatedVideoView";
import { Heart, Share2, Bookmark, Zap } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Motion } from "@legendapp/motion";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import { useCallback } from "react";
import { AVATAR_COLORS } from "@dvnt/app/lib/constants/events";
import { useRouter } from "expo-router";
import { useResponsiveMedia } from "@dvnt/app/lib/hooks/use-responsive-media";
import { useToggleEventLike } from "@dvnt/app/lib/hooks/use-events";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";
import type { PublicGateReason } from "@dvnt/app/lib/access/public-gates";
import { TranslateButton } from "@dvnt/app/components/ui/translate-button";
import { useContentTranslation } from "@dvnt/app/lib/stores/translation-store";
import { shouldShowTranslateButton } from "@dvnt/app/lib/utils/language-detection";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";

export function EventCard({
  event,
  index,
  scrollY,
  formatLikes,
  guestMode = false,
  onRequireAuth,
}: any) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toggleLike = useToggleEventLike();
  const showToast = useUIStore((s) => s.showToast);
  const { i18n } = useTranslation();
  const targetLang = i18n.language;

  const {
    displayText: translatedTitle,
    isTranslated: isTitleTranslated,
    translate: translateTitleFn,
    showOriginal: showOriginalTitle,
    isCapable: isTranslationCapable,
  } = useContentTranslation(
    `event-card-${event.id}-title`,
    event.title || "",
    targetLang,
  );

  const showTranslateButton =
    
    shouldShowTranslateButton(event.title || "", targetLang);

  const handleTranslate = useCallback(async () => {
    await translateTitleFn();
  }, [translateTitleFn]);

  const attendeePreview = Array.isArray(event.attendees) ? event.attendees : [];
  const totalAttendees =
    typeof event.totalAttendees === "number"
      ? event.totalAttendees
      : attendeePreview.length;

  const requireAuth = useCallback(
    (reason: PublicGateReason) => {
      onRequireAuth?.(reason);
    },
    [onRequireAuth],
  );

  const handleLike = useCallback(() => {
    if (guestMode) {
      requireAuth("events");
      return;
    }
    toggleLike.mutate(
      { eventId: event.id, isLiked: event.isLiked ?? false },
      {
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err || "");
          if (msg.includes("Not authenticated") || msg.includes("expired")) {
            showToast("error", "Session expired", "Please log out and back in");
          } else {
            showToast("error", "Like failed", msg || "Failed to update like");
          }
        },
      },
    );
  }, [event.id, event.isLiked, guestMode, requireAuth, showToast, toggleLike]);

  const handleOpen = useCallback(() => {
    if (guestMode) {
      // Guest-mode taps open the public event detail, where the visitor
      // can pick a tier and complete a guest (email-only) purchase.
      // The auth gate is still one tap away from inside that screen.
      screenPrefetch.eventDetail(queryClient, event.id);
      router.push(`/(public)/events/${event.id}` as any);
      return;
    }
    screenPrefetch.eventDetail(queryClient, event.id);
    router.push(`/(protected)/events/${event.id}` as any);
  }, [event.id, guestMode, queryClient, router]);

  // Responsive sizing: full width on phone, max 614px centered on tablet
  const {
    width: cardWidth,
    height: CARD_HEIGHT,
    containerClass,
  } = useResponsiveMedia("square"); // 1:1 aspect ratio for events
  const animatedImageStyle = useAnimatedStyle(() => {
    "worklet";
    const translateY = (scrollY.value - index * (CARD_HEIGHT + 20)) * -0.15;
    return {
      transform: [{ translateY }],
    };
  });

  return (
    <Motion.View
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        damping: 20,
        stiffness: 300,
        delay: index * 0.15,
      }}
      className={containerClass}
    >
      <Motion.View
        className="rounded-3xl overflow-hidden mb-5"
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
      >
        <Pressable
          onPress={handleOpen}
        >
          <View style={{ height: CARD_HEIGHT }} className="w-full">
            <Animated.View
              style={[
                {
                  width: "100%",
                  height: CARD_HEIGHT + 100,
                  position: "absolute",
                  top: -50,
                },
                animatedImageStyle,
              ]}
            >
              {/* Video flyer is the hero medium when present — the asset
                  the organizer crafted for this event. Falls back to the
                  static cover image otherwise. */}
              {event.flyerVideoUrl ? (
                <DVNTAnimatedVideoView
                  uri={event.flyerVideoUrl}
                  width="100%"
                  height="100%"
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                  muted
                />
              ) : (
                <Image
                  source={{ uri: event.image }}
                  style={{ width: "100%", height: "100%" }}
                  contentFit="cover"
                />
              )}
            </Animated.View>
            <LinearGradient
              colors={["transparent", "rgba(0,0,0,0.4)", "rgba(0,0,0,0.8)"]}
              className="absolute inset-0"
            />

            {/* Attendees */}
            <View className="absolute top-4 left-4 flex-row items-center">
              {attendeePreview.slice(0, 3).map((attendee: any, idx: number) => (
                <View
                  key={idx}
                  className="w-10 h-10 rounded-xl border-2 border-background justify-center items-center overflow-hidden"
                  style={{
                    marginLeft: idx === 0 ? 0 : -12,
                    backgroundColor: attendee.initials
                      ? AVATAR_COLORS[idx % 5]
                      : "transparent",
                  }}
                >
                  {attendee.image ? (
                    <Image
                      source={{ uri: attendee.image }}
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <Text className="text-white text-xs font-semibold">
                      {attendee.initials}
                    </Text>
                  )}
                </View>
              ))}
              <View className="ml-2 bg-black/40 px-2 py-1 rounded-xl">
                <Text className="text-white text-xs font-medium">
                  +{Math.max(totalAttendees - attendeePreview.slice(0, 3).length, 0)}
                </Text>
              </View>
            </View>

            {/* Date Badge */}
            <Motion.View
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", delay: index * 0.1 }}
              className="absolute top-4 right-4 bg-background rounded-2xl px-4 py-3 items-center min-w-[70px]"
            >
              <Text className="text-2xl font-bold text-foreground">
                {event.date}
              </Text>
              <Text className="text-[10px] text-muted-foreground uppercase mt-0.5">
                {event.month}
              </Text>
            </Motion.View>

            {/* Event Details */}
            <Animated.View className="absolute bottom-0 left-0 right-0 p-6">
              <View
                style={{
                  flexDirection: "row",
                  gap: 6,
                  flexWrap: "wrap",
                  alignSelf: "flex-start",
                  marginBottom: 12,
                }}
              >
                <View className="bg-white/20 px-3 py-1.5 rounded-xl">
                  <Text className="text-white text-xs font-medium">
                    {event.category}
                  </Text>
                </View>
                {event.isPromoted ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 12,
                      backgroundColor: "rgba(245,158,11,0.90)",
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
                      PROMOTED
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 8, gap: 10 }}>
                <Text
                  className="text-white text-[28px] font-bold"
                  style={{ flex: 1 }}
                  numberOfLines={3}
                >
                  {translatedTitle || event.title}
                </Text>
                {showTranslateButton && (
                  <View style={{ marginTop: 6 }}>
                    <TranslateButton
                      onTranslate={handleTranslate}
                      isTranslated={isTitleTranslated}
                      onToggleOriginal={showOriginalTitle}
                      size="sm"
                    />
                  </View>
                )}
              </View>
              <Text className="text-white/80 text-sm mb-4">
                {event.time} • {totalAttendees} participants
              </Text>

              <View className="flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <Pressable
                    onPress={(e) => {
                      e.stopPropagation?.();
                      handleLike();
                    }}
                    hitSlop={8}
                    className="flex-row items-center gap-1.5 bg-white/20 px-4 py-2 rounded-xl"
                  >
                    <Heart
                      size={16}
                      color={event.isLiked ? "#FF5BFC" : "#fff"}
                      fill={event.isLiked ? "#FF5BFC" : "transparent"}
                    />
                    <Text className="text-white text-sm font-medium">
                      {formatLikes(event.likes ?? 0)}
                    </Text>
                  </Pressable>
                  <Pressable
                    className="bg-white/20 p-2 rounded-xl"
                    onPress={(e) => {
                      e.stopPropagation?.();
                      requireAuth("events");
                    }}
                  >
                    <Share2 size={16} color="#fff" />
                  </Pressable>
                  <Pressable
                    className="bg-white/20 p-2 rounded-xl"
                    onPress={(e) => {
                      e.stopPropagation?.();
                      requireAuth("events");
                    }}
                  >
                    <Bookmark size={16} color="#fff" />
                  </Pressable>
                </View>
                <View className="bg-primary px-5 py-2 rounded-xl">
                  <Text className="text-white text-base font-bold">
                    ${event.price}
                  </Text>
                </View>
              </View>
            </Animated.View>
          </View>
        </Pressable>
      </Motion.View>
    </Motion.View>
  );
}
