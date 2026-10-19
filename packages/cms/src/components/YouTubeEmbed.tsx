import React from 'react'
import { youtubeEmbed } from '../posts/youtube'

export type YouTubeEmbedProps = { url?: unknown; title?: unknown; caption?: unknown }

/** Shared by the article and editor preview; stored HTML has the same policy. */
export default function YouTubeEmbed({ url, title, caption }: YouTubeEmbedProps) {
  const embed = youtubeEmbed(url, title)
  if (!embed) return <p role="note">Video unavailable. Add a valid YouTube URL to this block.</p>
  return (
    <figure data-youtube-embed style={{ margin: '1.5em 0', width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <iframe
        src={embed.src}
        title={embed.title}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allow="encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        style={{ display: 'block', width: '100%', aspectRatio: '16 / 9', border: 0, borderRadius: 12, background: '#000' }}
      />
      {typeof caption === 'string' && caption.trim() && (
        <figcaption style={{ marginTop: 8, fontSize: '0.875em', overflowWrap: 'anywhere' }}>{caption}</figcaption>
      )}
    </figure>
  )
}
