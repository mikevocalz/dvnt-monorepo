import type { Metadata } from 'next';
import { PostDetailClient } from './post-detail-client';

type Params = { username: string; id: string };

/**
 * Server-rendered OG/Twitter metadata so SHARED post links show a rich preview
 * (image + caption) in iMessage / social / crawlers — the interactive UI still
 * loads client-side. Best-effort fetch of the post via Supabase REST; falls back
 * to generic DVNT metadata if it's unavailable.
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
        `${url}/rest/v1/posts?id=eq.${encodeURIComponent(
          id,
        )}&select=content,media:posts_media(url,type,_order)`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          next: { revalidate: 300 },
        },
      );
      if (res.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const post = (await res.json())?.[0] as any;
        if (post?.content) description = String(post.content).slice(0, 200);
        const imgs = (post?.media ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .filter((m: any) => m?.url && m?.type !== 'video')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .sort((a: any, b: any) => (a._order ?? 0) - (b._order ?? 0));
        image = imgs[0]?.url;
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
