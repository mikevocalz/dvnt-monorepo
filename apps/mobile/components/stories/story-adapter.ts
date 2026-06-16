/**
 * Story Data Adapter
 * Transforms the app's Story type → react-native-insta-story IUserStory format
 */

import type { Story } from "@/lib/types";
import type { IUserStory, IUserStoryItem } from "react-native-insta-story";

/**
 * Convert app Story[] → IUserStory[] for InstaStory component
 */
export function toInstaStoryData(stories: Story[]): IUserStory[] {
  return stories
    .filter((s) => s.items && s.items.length > 0)
    .map((story, idx) => ({
      user_id: idx,
      user_image: story.avatar || undefined,
      user_name: story.username || "Unknown",
      seen: story.isViewed,
      stories: (story.items || []).map((item, itemIdx) => {
        const isVideo =
          item.type === "video" &&
          item.url &&
          (item.url.endsWith(".mp4") ||
            item.url.endsWith(".mov") ||
            item.url.includes("video"));

        return {
          story_id: itemIdx,
          story_image: item.url || undefined,
          story_video: isVideo ? item.url : undefined,
          swipeText: "",
          onPress: undefined,
          // Pass through custom data for overlays
          customData: {
            appStoryId: story.id,
            appUserId: story.userId,
            username: story.username,
            avatar: story.avatar,
            itemType: item.type,
            text: item.text,
            textColor: item.textColor,
            backgroundColor: item.backgroundColor,
            duration: item.duration || 5000,
            isYou: story.isYou,
            isCloseFriends: story.hasCloseFriendsStory || false,
            visibility: item.visibility || "public",
          },
        } as IUserStoryItem & { customData: StoryItemCustomData };
      }),
    }));
}

export interface StoryItemCustomData {
  appStoryId: string;
  appUserId?: string;
  username: string;
  avatar: string;
  itemType: "image" | "gif" | "video" | "text";
  text?: string;
  textColor?: string;
  backgroundColor?: string;
  duration: number;
  isYou?: boolean;
  isCloseFriends?: boolean;
  visibility?: "public" | "close_friends";
}

/**
 * Find the index of a story by its app-level story ID
 */
export function findStoryIndex(
  instaData: IUserStory[],
  appStoryId: string,
): number {
  return instaData.findIndex((s) => {
    const firstItem = s.stories[0] as IUserStoryItem & {
      customData?: StoryItemCustomData;
    };
    return firstItem?.customData?.appStoryId === appStoryId;
  });
}
