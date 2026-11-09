import type { Metadata } from 'next';
import { PostDetailClient } from './post-detail-client';

type Params = { username: string; id: string };

/**
 * Server-rendered OG/Twitter metadata so SHARED post links show a rich preview
 * (image + caption) in iMessage / social / crawlers — the interactive UI still
 * loads client-side. Only the server's public-safe projection may provide
 * previews. Private or Spicy posts always use generic metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { username, id } = await params;
  const handle = `@${decodeURIComponent(username)}`;
  const canonical = `https://dvntapp.live/feed/${username}/post/${id}`;

  let title = `${handle} on DVNT`;
  let description = 'connect. gather. move.';
  let image: string | undefined;

  try {
    const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) {
      const res = await fetch(
        `${url}/rest/v1/rpc/public_post_share_preview`,
        {
          method: 'POST',
          headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ p_post_id: id }),
          // A previous public response must not outlive a privacy change.
          cache: 'no-store',
        },
      );
      if (res.ok) {
        const preview: unknown = await res.json();
        if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
          const value = preview as { description?: unknown; image?: unknown };
          if (typeof value.description === 'string' && value.description) description = value.description.slice(0, 200);
          if (typeof value.image === 'string' && /^https?:\/\//.test(value.image)) image = value.image;
        }
      }
    }
  } catch {
    // fall back to generic metadata
  }

  const images = image ? [{ url: image }] : undefined;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'article',
      siteName: 'DVNT',
      images,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default function Page() {
  return <PostDetailClient />;
}
