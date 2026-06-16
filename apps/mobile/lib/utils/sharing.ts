import { Alert, Platform, Share } from "react-native";

const APP_SCHEME = "dvnt";
const WEB_BASE_URL = "https://dvntapp.live";

export interface ShareableContent {
  type: "post" | "profile" | "event" | "story";
  id: string;
  title?: string;
  message?: string;
}

export function generateDeepLink(content: ShareableContent): string {
  const { type, id } = content;

  switch (type) {
    case "post":
      return `${WEB_BASE_URL}/p/${id}`;
    case "profile":
      return `${WEB_BASE_URL}/u/${id}`;
    case "event":
      return `${WEB_BASE_URL}/e/${id}`;
    case "story":
      return `${WEB_BASE_URL}/story/${id}`;
    default:
      return WEB_BASE_URL;
  }
}

export function generateAppDeepLink(content: ShareableContent): string {
  const { type, id } = content;

  switch (type) {
    case "post":
      return `${APP_SCHEME}://p/${id}`;
    case "profile":
      return `${APP_SCHEME}://u/${id}`;
    case "event":
      return `${APP_SCHEME}://e/${id}`;
    case "story":
      return `${APP_SCHEME}://story/${id}`;
    default:
      return `${APP_SCHEME}://`;
  }
}

export async function shareContent(content: ShareableContent): Promise<void> {
  const url = generateDeepLink(content);
  const message = content.message || getDefaultMessage(content);
  const fullMessage = message.includes(url) ? message : `${message}\n\n${url}`;

  console.log("[Sharing] Attempting to share:", { content, url, message });

  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: content.title || "Check this out!",
          text: message,
          url: url,
        });
        console.log("[Sharing] Web share completed");
      } else {
        await copyToClipboard(url);
        Alert.alert(
          "Link Copied",
          "The link has been copied to your clipboard.",
        );
      }
    } else {
      const result = await Share.share(
        {
          message: fullMessage,
          title: content.title || "Share",
        },
        {
          dialogTitle: content.title || "Share",
          subject: content.title || "Share",
        },
      );

      if (result.action === Share.sharedAction) {
        console.log("[Sharing] Share completed");
      } else if (result.action === Share.dismissedAction) {
        console.log("[Sharing] Share dismissed");
      }
    }
  } catch (error) {
    console.log("[Sharing] Error sharing:", error);
    const errorMessage = (error as Error).message;
    if (
      errorMessage !== "Share was dismissed" &&
      errorMessage !== "User did not share"
    ) {
      Alert.alert("Error", "Unable to share content. Please try again.");
    }
  }
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    if (
      Platform.OS === "web" &&
      typeof navigator !== "undefined" &&
      navigator.clipboard
    ) {
      await navigator.clipboard.writeText(text);
      console.log("[Sharing] Copied to clipboard:", text);
    }
  } catch (error) {
    console.log("[Sharing] Clipboard error:", error);
  }
}

function getDefaultMessage(content: ShareableContent): string {
  switch (content.type) {
    case "post":
      return "Check out this post!";
    case "profile":
      return "Check out this profile!";
    case "event":
      return "Check out this event!";
    case "story":
      return "Check out this story!";
    default:
      return "Check this out!";
  }
}

export async function sharePost(
  postId: string,
  caption?: string,
): Promise<void> {
  await shareContent({
    type: "post",
    id: postId,
    title: "Share Post",
    message: caption
      ? `${caption.substring(0, 100)}...`
      : "Check out this post!",
  });
}

export async function shareProfile(
  username: string,
  displayName?: string,
): Promise<void> {
  await shareContent({
    type: "profile",
    id: username,
    title: displayName ? `${displayName}'s Profile` : "Share Profile",
    message: displayName
      ? `Check out ${displayName}'s profile!`
      : "Check out this profile!",
  });
}

export async function shareEvent(
  eventId: string,
  eventName?: string,
): Promise<void> {
  await shareContent({
    type: "event",
    id: eventId,
    title: eventName || "Share Event",
    message: eventName ? `Check out ${eventName}!` : "Check out this event!",
  });
}

export async function shareStory(
  storyId: string,
  username?: string,
): Promise<void> {
  await shareContent({
    type: "story",
    id: storyId,
    title: "Share Story",
    message: username
      ? `Check out ${username}'s story!`
      : "Check out this story!",
  });
}
