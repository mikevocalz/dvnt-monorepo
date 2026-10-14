/**
 * Media-caption contract. Keep byte-identical with the edge _shared copy;
 * post-caption.test.ts checks parity. Text-card slides have their own limit.
 */
export const MAX_CAPTION_LENGTH = 2200;
export const MAX_CAPTION_RAW_LENGTH = 8000;
export const MAX_CAPTION_HASHTAGS = 30;
export const MAX_HASHTAG_LENGTH = 100;

export interface CaptionHashtag {
  /** Original token, including #, so display never rewrites the user's text. */
  text: string;
  /** NFC + lowercase identity for chips/discovery and legacy deduplication. */
  tag: string;
  start: number;
  end: number;
}

export function parseCaptionHashtags(caption: string): CaptionHashtag[] {
  // Letters, numbers, underscores and combining marks work across languages.
  // A boundary avoids treating URL fragments, email addresses or foo#bar as
  // hashtags. Punctuation may surround a tag but is never part of the token.
  const pattern = /(^|[^\p{L}\p{M}\p{N}_/#@])#([\p{L}\p{N}_][\p{L}\p{M}\p{N}_]*)/gu;
  // Classify whitespace-delimited addresses in one pass. Anchoring avoids
  // rescanning long prose and keeps punctuation-separated #party,@friend valid.
  const addresses = Array.from(caption.matchAll(/\S+/gu))
    .filter((match) => {
      const span = match[0].replace(/^[([<"']+/, "");
      return /^(?:[a-z][a-z0-9+.-]*:\/\/|www\.)/iu.test(span) ||
        /^[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+[/?#]/u.test(span) ||
        /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/iu.test(span);
    })
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
  const tags: CaptionHashtag[] = [];
  for (const match of caption.matchAll(pattern)) {
    const start = match.index + match[1].length;
    if (addresses.some((address) => start >= address.start && start < address.end)) continue;
    tags.push({
      text: `#${match[2]}`,
      tag: match[2].normalize("NFC").toLowerCase(),
      start,
      end: start + match[2].length + 1,
    });
  }
  return tags;
}

export function getCaptionMetrics(caption: string) {
  const tokens = parseCaptionHashtags(caption);
  let prose = "";
  let end = 0;
  for (const token of tokens) {
    prose += caption.slice(end, token.start);
    end = token.end;
  }
  prose += caption.slice(end);
  return {
    // Keep the established JS/UTF-16 character budget. Whitespace left at the
    // edges by an appended hashtag block does not consume the prose budget.
    characterCount: prose.trim().length,
    hashtags: [...new Set(tokens.map((token) => token.tag))],
    tokens,
  };
}

export function validatePostCaption(value: unknown): { valid: boolean; error?: string } {
  if (value === undefined) return { valid: true };
  if (typeof value !== "string") return { valid: false, error: "Caption must be text" };
  if (value.length > MAX_CAPTION_RAW_LENGTH) {
    return { valid: false, error: `Caption including hashtags must be ${MAX_CAPTION_RAW_LENGTH.toLocaleString("en-US")} characters or less` };
  }
  const { characterCount, tokens } = getCaptionMetrics(value);
  if (tokens.length > MAX_CAPTION_HASHTAGS) {
    return { valid: false, error: `Use up to ${MAX_CAPTION_HASHTAGS} hashtags per caption` };
  }
  if (tokens.some((token) => Array.from(token.text.slice(1)).length > MAX_HASHTAG_LENGTH)) {
    return { valid: false, error: `Each hashtag must be ${MAX_HASHTAG_LENGTH} characters or less` };
  }
  if (characterCount > MAX_CAPTION_LENGTH) {
    return { valid: false, error: `Caption must be ${MAX_CAPTION_LENGTH.toLocaleString("en-US")} characters or less, excluding hashtags` };
  }
  return { valid: true };
}

/** Preserve older drafts' separate tags, appending only those not already inline. */
export function appendLegacyCaptionTags(caption: string, legacyTags: readonly string[]): string {
  const seen = new Set(getCaptionMetrics(caption).hashtags);
  const missing: string[] = [];
  for (const value of legacyTags) {
    if (typeof value !== "string") continue;
    const tag = value.trim().replace(/^#+/, "");
    const key = tag.normalize("NFC").toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    missing.push(`#${tag}`);
  }
  if (!missing.length) return caption;
  return `${caption}${caption && !/\s$/.test(caption) ? "\n" : ""}${missing.join(" ")}`;
}
