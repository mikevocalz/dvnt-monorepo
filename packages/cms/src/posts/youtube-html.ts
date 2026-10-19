import type { HTMLConvertersFunctionAsync } from '@payloadcms/richtext-lexical/html-async'
import { youtubeEmbed } from './youtube'

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!)

export function youtubeHTML(fields: Record<string, unknown>) {
  const embed = youtubeEmbed(fields.url, fields.title)
  if (!embed) return '<p role="note">Video unavailable. Add a valid YouTube URL to this block.</p>'
  const caption = typeof fields.caption === 'string' && fields.caption.trim()
    ? `<figcaption style="margin-top:8px;font-size:0.875em;overflow-wrap:anywhere">${escapeHTML(fields.caption)}</figcaption>` : ''
  return `<figure data-youtube-embed style="margin:1.5em 0;width:100%;max-width:100%;min-width:0"><iframe src="${embed.src}" title="${escapeHTML(embed.title)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen style="display:block;width:100%;aspect-ratio:16 / 9;border:0;border-radius:12px;background:#000"></iframe>${caption}</figure>`
}

export const postHTMLConverters: HTMLConvertersFunctionAsync = ({ defaultConverters }) => {
  const converters = { ...defaultConverters }
  converters.blocks = {
    ...defaultConverters.blocks,
    youtube: ({ node }) => youtubeHTML(node.fields),
    // Preserve the legacy JSON shape; old YouTube Video Embed blocks work too.
    videoEmbed: ({ node }) => youtubeHTML(node.fields),
  }
  return converters
}
