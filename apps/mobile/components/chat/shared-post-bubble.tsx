import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { navigateToPost } from "@/lib/routes/post-routes";
import { Avatar } from "@/components/ui/avatar";
import type { SharedPostContext } from "@/lib/stores/chat-store";

interface SharedPostBubbleProps {
  sharedPost: SharedPostContext;
  isOwnMessage: boolean;
}

export function SharedPostBubble({
  sharedPost,
  isOwnMessage,
}: SharedPostBubbleProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const handlePress = () => {
    if (sharedPost.postId) {
      navigateToPost(router, queryClient, sharedPost.postId);
    }
  };

  return (
    <Pressable onPress={handlePress} style={styles.container}>
      {/* Post media preview */}
      {sharedPost.mediaUrl ? (
        <Image
          source={{ uri: sharedPost.mediaUrl }}
          style={styles.mediaPreview}
          contentFit="cover"
          transition={0}
          cachePolicy="memory-disk"
          recyclingKey={sharedPost.mediaUrl}
        />
      ) : (
        <View style={[styles.mediaPreview, styles.noMedia]}>
          <Text style={styles.noMediaText}>No preview</Text>
        </View>
      )}

      {/* Post info footer */}
      <View style={styles.footer}>
        <Avatar
          uri={sharedPost.authorAvatar}
          username={sharedPost.authorUsername}
          size={24}
          variant="roundedSquare"
        />
        <View style={styles.footerText}>
          <Text style={styles.authorUsername} numberOfLines={1}>
            {sharedPost.authorUsername}
          </Text>
          {sharedPost.caption ? (
            <Text style={styles.caption} numberOfLines={2}>
              {sharedPost.caption}
            </Text>
          ) : null}
        </View>
      </View>

      {/* Tap to view label */}
      <View style={styles.tapLabel}>
        <Text style={styles.tapLabelText}>Tap to view post</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    width: 240,
  },
  mediaPreview: {
    width: "100%",
    height: 200,
  },
  noMedia: {
    backgroundColor: "rgba(255,255,255,0.04)",
    alignItems: "center",
    justifyContent: "center",
  },
  noMediaText: {
    color: "rgba(255,255,255,0.3)",
    fontSize: 12,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  footerText: {
    flex: 1,
  },
  authorUsername: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
  caption: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    marginTop: 1,
  },
  tapLabel: {
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  tapLabelText: {
    color: "#3EA4E5",
    fontSize: 11,
    fontWeight: "500",
  },
});
