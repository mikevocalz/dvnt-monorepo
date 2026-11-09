import { redirect } from 'next/navigation';

/**
 * The short share link resolves through the viewer-authorized detail screen.
 * Anonymous author lookups cannot resolve protected posts and must not decide
 * whether a signed-in follower can open a shared link.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (/^[1-9]\d*$/.test(id)) redirect(`/feed/post/${encodeURIComponent(id)}`);
  redirect('/feed');
}
