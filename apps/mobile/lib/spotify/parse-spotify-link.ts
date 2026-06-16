/**
 * Parse a Spotify share URL into structured data.
 *
 * Spotify share URLs look like:
 *   https://open.spotify.com/track/6rqhFgbbKwnb9MLmUQDhG6?si=...
 *   https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy
 *   https://open.spotify.com/artist/0TnOYISbd1XYRBk9myaseg
 *   https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
 *   https://open.spotify.com/episode/...
 *   https://open.spotify.com/show/...
 */

export type SpotifyContentType =
  | "track"
  | "album"
  | "artist"
  | "playlist"
  | "episode"
  | "show"
  | "unknown";

export interface SpotifyLink {
  type: SpotifyContentType;
  id: string;
  url: string;
  embedUrl: string;
  oEmbedUrl: string;
}

const SPOTIFY_URL_REGEX =
  /https?:\/\/open\.spotify\.com\/(track|album|artist|playlist|episode|show)\/([a-zA-Z0-9]+)/;

export function isSpotifyUrl(text: string): boolean {
  return SPOTIFY_URL_REGEX.test(text);
}

export function extractSpotifyUrl(text: string): string | null {
  const match = text.match(
    /https?:\/\/open\.spotify\.com\/[^\s"'<>)}\]]+/,
  );
  return match ? match[0] : null;
}

export function parseSpotifyLink(url: string): SpotifyLink | null {
  const match = url.match(SPOTIFY_URL_REGEX);
  if (!match) return null;

  const type = match[1] as SpotifyContentType;
  const id = match[2];
  const cleanUrl = `https://open.spotify.com/${type}/${id}`;

  return {
    type,
    id,
    url: cleanUrl,
    embedUrl: `https://open.spotify.com/embed/${type}/${id}`,
    oEmbedUrl: `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
  };
}

export interface SpotifyOEmbed {
  title: string;
  thumbnail_url: string;
  thumbnail_width: number;
  thumbnail_height: number;
  provider_name: string;
  type: string;
}

export async function fetchSpotifyOEmbed(
  url: string,
): Promise<SpotifyOEmbed | null> {
  try {
    const oEmbedUrl = `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`;
    const res = await fetch(oEmbedUrl);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
