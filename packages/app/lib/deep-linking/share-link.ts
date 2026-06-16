/**
 * ShareLink Utility
 * Generates canonical HTTPS share URLs for any entity.
 * NEVER shares dvnt:// scheme externally — always HTTPS.
 */

import { Share } from "react-native";
import * as Haptics from "expo-haptics";
import { getLynkDisplayName } from "@dvnt/app/lib/branding/lynk-branding";

const PRODUCTION_DOMAIN = "https://dvntapp.live";

// ── URL Builders ─────────────────────────────────────────────────────

export const shareUrls = {
  profile: (username: string) => `${PRODUCTION_DOMAIN}/u/${username}`,
  profileById: (userId: string) => `${PRODUCTION_DOMAIN}/user/${userId}`,
  post: (postId: string) => `${PRODUCTION_DOMAIN}/p/${postId}`,
  event: (eventId: string) => `${PRODUCTION_DOMAIN}/e/${eventId}`,
  story: (storyId: string) => `${PRODUCTION_DOMAIN}/story/${storyId}`,
  ticket: (ticketId: string) => `${PRODUCTION_DOMAIN}/ticket/${ticketId}`,
  chat: (chatId: string) => `${PRODUCTION_DOMAIN}/chat/${chatId}`,
  sneakyLynk: (roomId: string) => `${PRODUCTION_DOMAIN}/sl/${roomId}`,
  comments: (postId: string) => `${PRODUCTION_DOMAIN}/comments/${postId}`,
};

// ── Share Functions ──────────────────────────────────────────────────

export interface ShareOptions {
  title?: string;
  message?: string;
}

export type ShareResult = "shared" | "dismissed" | "error";

/**
 * Share a profile link via the native share sheet.
 * Instagram-style: "Check out @username on DVNT"
 */
export async function shareProfile(
  username: string,
  displayName?: string,
): Promise<ShareResult> {
  const url = shareUrls.profile(username);
  const name = displayName || username;
  return shareUrl(url, {
    title: `${name} on DVNT`,
    message: `Check out @${username} on DVNT\n${url}`,
  });
}

/**
 * Share a post link via the native share sheet.
 */
export async function sharePost(
  postId: string,
  caption?: string,
): Promise<ShareResult> {
  const url = shareUrls.post(postId);
  return shareUrl(url, {
    title: "Post on DVNT",
    message: caption ? `${caption}\n${url}` : url,
  });
}

/**
 * Share an event link via the native share sheet.
 */
export async function shareEvent(
  eventId: string,
  eventName?: string,
): Promise<ShareResult> {
  const url = shareUrls.event(eventId);
  return shareUrl(url, {
    title: eventName || "Event on DVNT",
    message: eventName ? `${eventName}\n${url}` : url,
  });
}

export async function shareSneakyLynk(
  roomId: string,
  roomName?: string,
): Promise<ShareResult> {
  const url = shareUrls.sneakyLynk(roomId);
  const lynkName = getLynkDisplayName();
  return shareUrl(url, {
    title: roomName ? `${roomName} - ${lynkName}` : `${lynkName} on DVNT`,
    message: roomName ? `Join ${roomName} on DVNT\n${url}` : url,
  });
}

/**
 * Share a story link via the native share sheet.
 */
export async function shareStory(storyId: string): Promise<ShareResult> {
  const url = shareUrls.story(storyId);
  return shareUrl(url, {
    title: "Story on DVNT",
    message: url,
  });
}

/**
 * Core share function — opens the native share sheet.
 * Returns a result classification so callers can distinguish
 * cancellation from a real native share failure.
 */
export async function shareUrl(
  url: string,
  options?: ShareOptions,
): Promise<ShareResult> {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    const shareMessage = options?.message?.includes(url)
      ? options.message
      : options?.message
        ? `${options.message}\n${url}`
        : url;

    const result = await Share.share(
      {
        message: shareMessage,
        title: options?.title || "DVNT",
      },
      {
        dialogTitle: options?.title || "Share via DVNT",
        subject: options?.title || "DVNT",
      },
    );

    return result.action === Share.sharedAction ? "shared" : "dismissed";
  } catch (error) {
    console.error("[ShareLink] Share failed:", error);
    return "error";
  }
}

/**
 * Copy a share URL to clipboard.
 * Uses react-native's deprecated but universally available Clipboard.
 */
export function copyShareUrl(url: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Clipboard: RNClipboard } = require("react-native");
    if (RNClipboard?.setString) {
      RNClipboard.setString(url);
    }
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    ).catch(() => {});
  } catch (error) {
    console.error("[ShareLink] Copy failed:", error);
  }
}
