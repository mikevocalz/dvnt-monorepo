/**
 * StoryReplyBubble — story reply context in DMs.
 *
 * Shape: a compact quoted-story strip with the reply underneath, the way a
 * quote-reply reads everywhere else. The story is CONTEXT for the reply, not
 * the subject of the message — so it is a 44x60 thumbnail on a row, not a
 * 160pt-tall full-bleed panel above the text.
 *
 * That panel was the bug in the screenshot: an expired story rendered as a
 * near-empty dark rectangle taller than the message it belonged to, with a
 * one-word reply ("heart") stranded at the bottom. The content was 3% of the
 * box.
 *
 * EXPLICIT STYLES, NOT className. Every layout value here is an inline style.
 * On web this component was rendering with none of its Tailwind classes
 * resolved — no radius, no padding, no centering — so the header sat flush in
 * the corner and the expired placeholder pinned to the top of its box. Inline
 * styles are the same values, minus the dependency on class resolution
 * differing between the native and web pipelines. Colours stay literal for the
 * same reason; this is one small leaf component, not a licence to abandon
 * tokens elsewhere.
 */

import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import { ImageOff } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import type { StoryReplyContext } from "@dvnt/app/lib/stores/chat-store";

interface StoryReplyBubbleProps {
  storyReply: StoryReplyContext;
  replyText: string;
  isOwnMessage: boolean;
}

const THUMB_W = 44;
const THUMB_H = 60;

export function StoryReplyBubble({
  storyReply,
  replyText,
  isOwnMessage,
}: StoryReplyBubbleProps) {
  const router = useRouter();

  const handleStoryPress = useCallback(() => {
    if (storyReply.isExpired) return;
    if (storyReply.storyId || storyReply.storyUsername) {
      // Pass username as fallback — group IDs change when new stories are
      // posted, so a stale storyId from metadata may not match the current one.
      const storyId = storyReply.storyId || "0";
      const usernameParam = storyReply.storyUsername
        ? `?username=${encodeURIComponent(storyReply.storyUsername)}`
        : "";
      router.push(`/(protected)/story/${storyId}${usernameParam}` as any);
    }
  }, [storyReply, router]);

  const handleProfilePress = useCallback(() => {
    if (storyReply.storyUsername) {
      router.push(`/(protected)/profile/${storyReply.storyUsername}` as any);
    }
  }, [storyReply.storyUsername, router]);

  const label = isOwnMessage
    ? `You replied to ${storyReply.storyUsername ?? "their"}'s story`
    : "Replied to your story";

  return (
    <View
      style={{
        maxWidth: 300,
        borderRadius: 18,
        overflow: "hidden",
        paddingVertical: 10,
        paddingHorizontal: 12,
        gap: 8,
        backgroundColor: isOwnMessage
          ? "rgba(62, 164, 229, 0.12)"
          : "rgba(255, 255, 255, 0.07)",
      }}
    >
      {/* Quoted story: thumbnail + who, on one row. The whole row is the
          affordance — a 44pt-wide thumbnail is too small to be the only target. */}
      <Pressable
        onPress={storyReply.isExpired ? handleProfilePress : handleStoryPress}
        accessibilityRole="button"
        accessibilityLabel={
          storyReply.isExpired ? `${label}. Story no longer available.` : label
        }
        style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
      >
        <View
          style={{
            width: THUMB_W,
            height: THUMB_H,
            borderRadius: 8,
            overflow: "hidden",
            backgroundColor: "rgba(255,255,255,0.06)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {storyReply.isExpired ? (
            <ImageOff size={16} color="rgba(255,255,255,0.35)" />
          ) : storyReply.storyMediaUrl ? (
            <Image
              source={{ uri: storyReply.storyMediaUrl }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={0}
              cachePolicy="memory-disk"
              recyclingKey={storyReply.storyMediaUrl}
            />
          ) : (
            <ImageOff size={16} color="rgba(255,255,255,0.25)" />
          )}
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          {/* The relationship line. Dim on purpose — it is the caption for the
              reply, and it must never out-shout the message itself. */}
          <Text
            numberOfLines={1}
            style={{
              fontSize: 12,
              lineHeight: 16,
              color: "rgba(255,255,255,0.55)",
            }}
          >
            {label}
          </Text>
          {/* Expired says so here, in words, next to the thing it describes —
              rather than as a placeholder filling a large empty panel. */}
          {storyReply.isExpired ? (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                lineHeight: 16,
                color: "rgba(255,255,255,0.35)",
              }}
            >
              Story no longer available
            </Text>
          ) : (
            <Text
              numberOfLines={1}
              style={{
                fontSize: 12,
                lineHeight: 16,
                color: "rgba(62, 164, 229, 0.9)",
              }}
            >
              View story
            </Text>
          )}
        </View>
      </Pressable>

      {/* The actual message. Largest text in the bubble, because it is the
          point of it — the quoted story above is supporting context. */}
      <Text style={{ fontSize: 15, lineHeight: 20, color: "#fff" }}>
        {replyText}
      </Text>
    </View>
  );
}
