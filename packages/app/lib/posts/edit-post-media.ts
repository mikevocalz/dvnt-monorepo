/** The server checks the exact ordered snapshot again before changing the post. */
type EditableMedia = { mediaId?: string; order?: number };
export type PostMediaRemoval = { expectedIds: string[]; ids: string[] };

export function getEditableMediaIds(media: readonly EditableMedia[]): string[] {
  if (!media.length || media.length > 10) return [];
  const ids = media.map((item) => item.mediaId);
  const orders = media.map((item) => item.order);
  return ids.every((id): id is string => typeof id === "string" && id.length > 0) &&
    orders.every((order) => Number.isSafeInteger(order)) &&
    new Set(ids).size === media.length && new Set(orders).size === media.length
    ? ids : [];
}

export function toggleMediaRemoval(
  expectedIds: string[],
  current: PostMediaRemoval | null,
  mediaId: string,
): PostMediaRemoval | null {
  if (!expectedIds.includes(mediaId)) return current;
  if (current && (current.expectedIds.length !== expectedIds.length ||
      current.expectedIds.some((id, index) => id !== expectedIds[index]))) return current;
  const remove = new Set(current?.ids);
  if (remove.has(mediaId)) remove.delete(mediaId);
  else if (remove.size < expectedIds.length - 1) remove.add(mediaId);
  return remove.size ? { expectedIds, ids: expectedIds.filter((id) => remove.has(id)) } : null;
}
