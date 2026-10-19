/** Only a validated YouTube ID is ever interpolated into an embed URL. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be'])
const EMBED_HOSTS = new Set(['youtube-nocookie.com', 'www.youtube-nocookie.com'])

export function youtubeVideoID(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const input = value.trim()
  if (!input || /[\s\\\u0000-\u001f\u007f]/.test(input)) return null
  try {
    const url = new URL(input)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return null
    let id: string | null = null
    if (SHORT_HOSTS.has(url.hostname)) {
      const match = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)
      id = match?.[1] ?? null
    } else if (YOUTUBE_HOSTS.has(url.hostname)) {
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
        id = url.searchParams.get('v')
      } else {
        id = /^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null
      }
    } else if (EMBED_HOSTS.has(url.hostname)) {
      id = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1] ?? null
    }
    return id && VIDEO_ID.test(id) ? id : null
  } catch {
    return null
  }
}

export const YOUTUBE_URL_HELP = 'Paste a full YouTube watch, youtu.be, or Shorts URL.'
export const validateYouTubeURL = (value: unknown): true | string =>
  youtubeVideoID(value) ? true : YOUTUBE_URL_HELP

export function youtubeEmbed(value: unknown, title?: unknown) {
  const id = youtubeVideoID(value)
  if (!id) return null
  return {
    src: `https://www.youtube-nocookie.com/embed/${id}`,
    title: typeof title === 'string' && title.trim() ? title.trim() : 'YouTube video player',
  }
}
