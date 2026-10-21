/** Server-issued share notices. User-authored messages cannot mint this type. */
export interface StoryShareContext {
  storyId: string;
  sourceType: "post" | "event";
  sourceId: string;
  sourceTitle?: string;
}

function positiveId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const id = String(value);
  return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))
    ? id
    : undefined;
}

export function parseStoryShareContext(
  metadata: unknown,
): StoryShareContext | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return undefined;
  const meta = metadata as Record<string, unknown>;
  if (
    meta.type !== "story_share" ||
    (meta.sourceType !== "post" && meta.sourceType !== "event")
  )
    return undefined;
  const storyId = positiveId(meta.storyId);
  const sourceId = positiveId(meta.sourceId);
  if (!storyId || !sourceId) return undefined;
  return {
    storyId,
    sourceId,
    sourceType: meta.sourceType,
    sourceTitle:
      typeof meta.sourceTitle === "string"
        ? meta.sourceTitle.slice(0, 280)
        : undefined,
  };
}

/** Only construct same-origin routes from validated identifiers, never a metadata URL. */
export function storyShareSourcePath(
  share: StoryShareContext,
): string | undefined {
  const sourceId = positiveId(share.sourceId);
  if (!sourceId) return undefined;
  if (share.sourceType === "post") return `/feed/post/${sourceId}`;
  if (share.sourceType === "event") return `/feed/events/${sourceId}`;
  return undefined;
}
