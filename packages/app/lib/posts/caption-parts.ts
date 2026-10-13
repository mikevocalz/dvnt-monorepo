import { parseCaptionHashtags } from "./post-caption.ts";

export interface CaptionPart {
  type: "text" | "hashtag" | "mention";
  content: string;
  value: string;
}

/** Shared hashtag boundaries, while preserving the existing @username grammar. */
export function parseCaptionParts(text: string): CaptionPart[] {
  const tokens = [
    ...parseCaptionHashtags(text).map((token) => ({ ...token, type: "hashtag" as const })),
    ...Array.from(text.matchAll(/@[a-zA-Z0-9_]+/g), (match) => ({
      text: match[0], start: match.index, end: match.index + match[0].length,
      type: "mention" as const,
    })),
  ].sort((a, b) => a.start - b.start);
  const parts: CaptionPart[] = [];
  let end = 0;
  for (const token of tokens) {
    if (token.start < end) continue;
    if (token.start > end) {
      const content = text.slice(end, token.start);
      parts.push({ type: "text", content, value: content });
    }
    // Search currently matches the stored text directly; retain original
    // spelling/normalization so even a decomposed Unicode tag finds itself.
    parts.push({ type: token.type, content: token.text, value: token.text.slice(1) });
    end = token.end;
  }
  if (end < text.length) {
    const content = text.slice(end);
    parts.push({ type: "text", content, value: content });
  }
  return parts;
}
