import { redirect } from 'next/navigation';

/**
 * /p/:id — the SHORT share link mobile generates (lib/utils/sharing.ts).
 * Resolves the author and redirects to the canonical
 * /feed/<username>/post/<id>. Was a 404 — every shared post link was dead
 * on web. Best-effort lookup via Supabase REST; unknown ids land on /feed.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://npfjanxturvmjyevoyfo.supabase.co';
  const key =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  let username: string | null = null;
  try {
    const postRes = await fetch(
      `${url}/rest/v1/posts?id=eq.${encodeURIComponent(id)}&select=author_id`,
      { headers, next: { revalidate: 300 } },
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authorId = postRes.ok ? ((await postRes.json())?.[0] as any)?.author_id : null;
    if (authorId != null) {
      const userRes = await fetch(
        `${url}/rest/v1/users?id=eq.${encodeURIComponent(String(authorId))}&select=username`,
        { headers, next: { revalidate: 300 } },
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      username = userRes.ok ? (((await userRes.json())?.[0] as any)?.username ?? null) : null;
    }
  } catch {
    // fall through to feed
  }
  if (username) {
    redirect(`/feed/${encodeURIComponent(username)}/post/${encodeURIComponent(id)}`);
  }
  redirect('/feed');
}
