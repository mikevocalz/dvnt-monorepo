/**
 * TagOverlayViewer — Instagram tap-to-reveal tags on feed/detail images.
 *
 * Renders as an absolute overlay on top of the post image.
 * Tapping toggles tag visibility. Double-tap still triggers like.
 * Tag bubbles animate in with spring opacity+scale.
 *
 * Animation spec:
 *   Show: opacity 0→1 + scale 0.96→1, spring (damping 18, stiffness 180)
 *   Hide: opacity 1→0 (withTiming 180ms)
 */

import React, { useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import type { SharedValue } from "react-native-reanimated";
import { withTiming } from "react-native-reanimated";
import { TagBubble } from "./TagBubble";
import { usePostTags } from "@/lib/hooks/use-post-tags";
import type { PostTag } from "@/lib/api/post-tags";
import { routeToProfile } from "@/lib/utils/route-to-profile";
import { useAuthStore } from "@/lib/stores/auth-store";
import { usePostTagsUIStore } from "@/lib/stores/post-tags-store";
import { useQueryClient } from "@tanstack/react-query";

interface TagOverlayViewerProps {
  postId: string;
  /** Current carousel slide index (0 for single-image posts) */
  mediaIndex?: number;
  /** Reanimated shared value (0–1) driving show/hide animation, controlled by parent */
  tagProgress: SharedValue<number>;
  guestMode?: boolean;
}

export const TagOverlayViewer: React.FC<TagOverlayViewerProps> = React.memo(
  ({ postId, mediaIndex = 0, tagProgress, guestMode = false }) => {
    const router = useRouter();
    const queryClient = useQueryClient();
    const currentUserId = useAuthStore((s) => s.user?.id);
    const { data: allTags = [] } = usePostTags(postId);

    // Filter tags for current media slide
    const tags = allTags.filter((t: PostTag) => t.mediaIndex === mediaIndex);

    // Force hide when tags become empty
    if (tags.length === 0) {
      if (tagProgress.value !== 0) {
        tagProgress.value = withTiming(0, { duration: 100 });
      }
      return null;
    }

    const handleTagPress = useCallback(
      (tag: PostTag) => {
        routeToProfile({
          targetUserId: String(tag.taggedUserId),
          targetUsername: tag.username,
          viewerId: currentUserId,
          router,
          queryClient,
          guestMode,
        });
      },
      [currentUserId, guestMode, router, queryClient],
    );

    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {tags.map((tag) => (
          <TagBubble
            key={`tag-${postId}-${tag.taggedUserId}`}
            username={tag.username}
            x={tag.xPosition}
            y={tag.yPosition}
            progress={tagProgress}
            onPress={() => handleTagPress(tag)}
          />
        ))}
      </View>
    );
  },
);

TagOverlayViewer.displayName = "TagOverlayViewer";

/**
 * Hook to get the toggle handler for a specific post.
 * Used by the image Pressable to toggle tags on single tap.
 */
export function useTagToggle(postId: string) {
  const toggleTags = usePostTagsUIStore((s) => s.toggleTags);
  const isVisible = usePostTagsUIStore((s) => s.visibleTags[postId] ?? false);
  const { data: allTags = [] } = usePostTags(postId);
  const hasTags = allTags.length > 0;

  const toggle = useCallback(() => {
    if (hasTags) {
      toggleTags(postId);
    }
  }, [hasTags, toggleTags, postId]);

  return { toggle, isVisible, hasTags };
}
