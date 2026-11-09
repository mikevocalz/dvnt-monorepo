import { notFound, redirect } from 'next/navigation';

/** Compatibility for earlier email links: use the event's existing section,
 * not a second reviews surface. Public details still gate all member writes. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  redirect(`/public/events/${id}?section=reviews`);
}
