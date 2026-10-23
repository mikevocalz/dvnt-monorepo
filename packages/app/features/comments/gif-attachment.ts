import type { CommentAttachment } from "../../lib/types/index";
import type { KlipyItem } from "../stickers/api/klipy";

/** Defense in depth before a provider result or cached record triggers a media request. */
export function isCommentGif(attachment: CommentAttachment): boolean {
  if (!attachment || !["klipy", "noto"].includes(attachment.provider))
    return false;
  if (
    !attachment.id ||
    attachment.id.length > 128 ||
    /[\x00-\x1f\x7f]/.test(attachment.id)
  )
    return false;
  if (
    typeof attachment.title !== "string" ||
    attachment.title.length > 200 ||
    /[\x00-\x1f\x7f]/.test(attachment.title)
  )
    return false;
  if (
    ![attachment.width, attachment.height].every(
      (size) => Number.isInteger(size) && size > 0 && size <= 4096,
    )
  )
    return false;
  return [attachment.url, attachment.previewUrl].every((value) => {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\s\\]/.test(value)
    )
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
      if (attachment.provider === "noto")
        return (
          url.hostname === "fonts.gstatic.com" &&
          !url.search &&
          /^\/s\/e\/notoemoji\/latest\/[a-f0-9_]+\/512\.gif$/.test(url.pathname)
        );
      return (
        ["static.klipy.com", "static1.klipy.com"].includes(url.hostname) &&
        /\.(gif|webp|png|jpe?g)$/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  });
}

export function commentGifFromItem(
  item: KlipyItem,
  source?: "klipy" | "fallback",
): CommentAttachment | null {
  const m = item.media_formats;
  // Comments don't need the original HD asset. Prefer an animated small WebP.
  const full = m.tinywebp ?? m.mediumgif ?? m.gif ?? m.webp ?? m.tinygif;
  const preview = m.nanowebp ?? m.tinywebp ?? m.nanogif ?? m.tinygif ?? full;
  if (!full || !preview) return null;
  const attachment: CommentAttachment = {
    provider: source === "fallback" ? "noto" : "klipy",
    id: item.id,
    title: (item.title || "GIF").slice(0, 200),
    url: full.url,
    previewUrl: preview.url,
    width: full.width,
    height: full.height,
  };
  return isCommentGif(attachment) ? attachment : null;
}
