/** Only provider-hosted images are persisted; never accept uploads or arbitrary URLs. */
export interface CommentAttachment {
  provider: "klipy" | "noto";
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  title: string;
}

const KLIPY_HOSTS = new Set(["static.klipy.com", "static1.klipy.com"]);
const KEYS = new Set([
  "provider",
  "id",
  "url",
  "previewUrl",
  "width",
  "height",
  "title",
]);
export const GIF_COMMENT_FALLBACK = "GIF";

function validImageUrl(
  value: unknown,
  provider: CommentAttachment["provider"],
): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\s\\]/.test(value))
    return false;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hash
    )
      return false;
    if (provider === "noto") {
      return (
        url.hostname === "fonts.gstatic.com" &&
        !url.search &&
        /^\/s\/e\/notoemoji\/latest\/[a-f0-9_]+\/512\.gif$/.test(url.pathname)
      );
    }
    return (
      KLIPY_HOSTS.has(url.hostname) &&
      /\.(gif|webp|png|jpe?g)$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/** null means absent or invalid. Writers must reject a supplied invalid value. */
export function normalizeCommentAttachment(
  value: unknown,
): CommentAttachment | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const a = value as Record<string, unknown>;
  if (Object.keys(a).some((key) => !KEYS.has(key))) return null;
  if (a.provider !== "klipy" && a.provider !== "noto") return null;
  if (
    typeof a.id !== "string" ||
    !a.id.trim() ||
    a.id.length > 128 ||
    /[\x00-\x1f\x7f]/.test(a.id)
  )
    return null;
  if (
    typeof a.title !== "string" ||
    a.title.length > 200 ||
    /[\x00-\x1f\x7f]/.test(a.title)
  )
    return null;
  if (
    !validImageUrl(a.url, a.provider) ||
    !validImageUrl(a.previewUrl, a.provider)
  )
    return null;
  if (
    typeof a.width !== "number" ||
    !Number.isInteger(a.width) ||
    a.width < 1 ||
    a.width > 4096 ||
    typeof a.height !== "number" ||
    !Number.isInteger(a.height) ||
    a.height < 1 ||
    a.height > 4096
  )
    return null;
  const attachment: CommentAttachment = {
    provider: a.provider,
    id: a.id.trim(),
    url: new URL(a.url).href,
    previewUrl: new URL(a.previewUrl).href,
    width: a.width,
    height: a.height,
    title: a.title.trim(),
  };
  // Canonical percent encoding may expand non-ASCII URLs; recheck persisted sizes.
  if (attachment.url.length > 2048 || attachment.previewUrl.length > 2048)
    return null;
  // Leave room for JSONB serialization whitespace within the database 8192-byte cap.
  return new TextEncoder().encode(JSON.stringify(attachment)).length <= 8000
    ? attachment
    : null;
}

export function normalizeCommentInput(
  content: unknown,
  value: unknown,
):
  | {
      ok: true;
      content: string;
      attachment: CommentAttachment | null;
      mentionText: string;
    }
  | { ok: false; message: string } {
  const attachment = normalizeCommentAttachment(value);
  if (value != null && !attachment)
    return { ok: false, message: "Invalid GIF attachment" };
  if (content != null && typeof content !== "string")
    return { ok: false, message: "content must be a string" };
  const text = typeof content === "string" ? content.trim() : "";
  if (!text && !attachment)
    return { ok: false, message: "content or GIF attachment is required" };
  // Keep content nonempty for old clients, notifications, and existing constraints.
  // Parse mentions only from the user text, not attachment metadata or fallback.
  return {
    ok: true,
    content: text || GIF_COMMENT_FALLBACK,
    attachment,
    mentionText: text,
  };
}
