/**
 * HyperlinkedText
 *
 * Parses a caption string and renders inline tappable spans for:
 *   @username  — navigates to /profile/[username]
 *   #hashtag   — navigates to /hashtag/[tag]
 *   https://…  — opens in expo-web-browser
 *
 * Falls back to plain Text for everything else.
 *
 * Usage:
 *   <HyperlinkedText className="text-sm text-foreground">
 *     {caption}
 *   </HyperlinkedText>
 */

import React, { memo, useCallback } from "react";
import { Text, Pressable } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

const TOKEN_RE = /(@[\w.]+|#[\w]+|https?:\/\/[^\s]+)/g;

interface HyperlinkedTextProps {
  children: string;
  style?: StyleProp<TextStyle>;
  className?: string;
  numberOfLines?: number;
  mentionColor?: string;
  hashtagColor?: string;
  linkColor?: string;
}

function tokenize(
  text: string,
): Array<{ type: "text" | "mention" | "hashtag" | "url"; value: string }> {
  const parts: Array<{
    type: "text" | "mention" | "hashtag" | "url";
    value: string;
  }> = [];
  let last = 0;
  let match: RegExpExecArray | null;

  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: "text", value: text.slice(last, match.index) });
    }
    const val = match[0];
    if (val.startsWith("@")) {
      parts.push({ type: "mention", value: val });
    } else if (val.startsWith("#")) {
      parts.push({ type: "hashtag", value: val });
    } else {
      parts.push({ type: "url", value: val });
    }
    last = match.index + val.length;
  }
  if (last < text.length) {
    parts.push({ type: "text", value: text.slice(last) });
  }
  return parts;
}

export const HyperlinkedText = memo(function HyperlinkedText({
  children,
  style,
  className,
  numberOfLines,
  mentionColor = "#8A40CF",
  hashtagColor = "#8A40CF",
  linkColor = "#60a5fa",
}: HyperlinkedTextProps) {
  const router = useRouter();

  const handleMention = useCallback(
    (username: string) => {
      router.push(`/profile/${username.slice(1)}` as any);
    },
    [router],
  );

  const handleHashtag = useCallback(
    (tag: string) => {
      router.push(`/hashtag/${tag.slice(1)}` as any);
    },
    [router],
  );

  const handleUrl = useCallback(async (url: string) => {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    });
  }, []);

  if (!children) return null;

  const tokens = tokenize(children);

  return (
    <Text style={style} className={className} numberOfLines={numberOfLines}>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "mention":
            return (
              <Text
                key={i}
                style={{ color: mentionColor, fontWeight: "800" }}
                onPress={() => handleMention(token.value)}
                suppressHighlighting
              >
                {token.value}
              </Text>
            );
          case "hashtag":
            return (
              <Text
                key={i}
                style={{ color: hashtagColor, fontWeight: "600" }}
                onPress={() => handleHashtag(token.value)}
                suppressHighlighting
              >
                {token.value}
              </Text>
            );
          case "url":
            return (
              <Text
                key={i}
                style={{ color: linkColor, textDecorationLine: "underline" }}
                onPress={() => handleUrl(token.value)}
                suppressHighlighting
              >
                {token.value}
              </Text>
            );
          default:
            return <Text key={i}>{token.value}</Text>;
        }
      })}
    </Text>
  );
});
