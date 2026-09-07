// Story overlay fields that carry user text into a JSONB column: the tappable
// mention / link / event / ticket payload. Bounded on the way in so a client
// can't push an arbitrarily deep or wide object into stories_stickers.data.

const MAX_TEXT = 256;
const MAX_METADATA_KEYS = 16;

/** A bounded non-empty string, or nothing. */
export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_TEXT)
    : undefined;
}

/** Flat string map only, bounded in both key count and value length. */
export function cleanMetadata(
  value: unknown,
): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value).slice(0, MAX_METADATA_KEYS)) {
    const cleaned = str(v);
    if (cleaned !== undefined) out[k.slice(0, MAX_TEXT)] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
