import type { StorySharedSource } from "../types";

/** Reject partial/legacy junk rather than attributing a share to its publisher. */
export function parseStorySharedSource(
  value: unknown,
): StorySharedSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const source = value as Record<string, unknown>;
  const author = source.author as Record<string, unknown> | undefined;
  if (
    (source.type !== "post" && source.type !== "event") ||
    typeof source.id !== "string" ||
    !/^[1-9]\d*$/.test(source.id) ||
    !author ||
    typeof author !== "object" ||
    typeof author.id !== "string" ||
    !/^[1-9]\d*$/.test(author.id) ||
    typeof author.username !== "string" ||
    !author.username.trim()
  )
    return;
  return {
    type: source.type,
    id: source.id,
    author: {
      id: author.id,
      username: author.username,
      name: typeof author.name === "string" ? author.name : "",
      avatar: typeof author.avatar === "string" ? author.avatar : "",
      ...(author.profileUnavailable === true
        ? { profileUnavailable: true }
        : {}),
    },
    ...(typeof source.title === "string" ? { title: source.title } : {}),
    ...(typeof source.caption === "string" ? { caption: source.caption } : {}),
  };
}

export function storySourcePath(source: StorySharedSource): string {
  return source.type === "event"
    ? `/e/${encodeURIComponent(source.id)}`
    : `/feed/post/${encodeURIComponent(source.id)}`;
}

/** Existing native text-story renderer can display media-less shared cards. */
export function storySourceText(source: StorySharedSource): string {
  const content =
    [source.title, source.caption].filter(Boolean).join("\n\n") ||
    `Shared ${source.type}`;
  const preview = content.length > 180 ? `${content.slice(0, 177)}…` : content;
  return `@${source.author.username}\n\n${preview}`;
}

// A local backdrop keeps the existing player/progress clock running for a text
// share. The actual canonical text and attribution are accessible HTML above it.
export const SHARED_STORY_BACKDROP =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='16'%3E%3Cpath fill='%231A0A2E' d='M0 0h9v16H0z'/%3E%3C/svg%3E";
