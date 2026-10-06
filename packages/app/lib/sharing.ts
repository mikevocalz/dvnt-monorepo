import { Share, Platform } from "react-native";

const APP_URL = "https://dvntapp.live";

interface ShareOptions {
  title: string;
  message: string;
  url?: string;
}

async function shareNative({ title, message, url }: ShareOptions) {
  try {
    const content: { title: string; message: string; url?: string } = {
      title,
      message: url ? `${message}\n${url}` : message,
    };
    if (Platform.OS === "ios" && url) {
      content.url = url;
    }
    await Share.share(content);
  } catch (err: any) {
    if (err?.message !== "User did not share") {
      console.error("[Share] Error:", err);
    }
  }
}

export const dvntShare = {
  post(postId: number, title?: string) {
    return shareNative({
      title: title || "Check out this post on DVNT",
      message: "Check out this post on DVNT",
      url: `${APP_URL}/post/${postId}`,
    });
  },

  event(eventId: number, eventTitle?: string) {
    return shareNative({
      title: eventTitle || "Check out this event on DVNT",
      message: eventTitle
        ? `${eventTitle} — on DVNT`
        : "Check out this event on DVNT",
      url: `${APP_URL}/e/${eventId}`,
    });
  },

  profile(username: string) {
    return shareNative({
      title: `@${username} on DVNT`,
      message: `Check out @${username} on DVNT`,
      url: `${APP_URL}/u/${username}`,
    });
  },

  story(storyId: number, authorUsername?: string) {
    return shareNative({
      title: authorUsername
        ? `@${authorUsername}'s story on DVNT`
        : "Check out this story on DVNT",
      message: "Check out this story on DVNT",
      url: `${APP_URL}/story/${storyId}`,
    });
  },

  custom(title: string, message: string, url?: string) {
    return shareNative({ title, message, url });
  },
};

export type ShareMessageOutcome = "shared" | "dismissed" | "unsupported";

/**
 * Share a ready-made message (link already inside it). Unlike shareNative this
 * reports what happened, so the caller can fall back to sms: or copy.
 *
 * Web goes straight to navigator.share: react-native-web's Share rejects when
 * the browser has none, and desktop Chrome/Firefox often have none.
 */
export async function shareMessage(content: {
  title: string;
  message: string;
}): Promise<ShareMessageOutcome> {
  if (Platform.OS === "web") {
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    if (!nav || typeof nav.share !== "function") return "unsupported";
    try {
      await nav.share({ title: content.title, text: content.message });
      return "shared";
    } catch (err: any) {
      return err?.name === "AbortError" ? "dismissed" : "unsupported";
    }
  }
  try {
    const result = await Share.share({ title: content.title, message: content.message });
    return result.action === Share.dismissedAction ? "dismissed" : "shared";
  } catch (err) {
    console.error("[Share] Error:", err);
    return "unsupported";
  }
}
