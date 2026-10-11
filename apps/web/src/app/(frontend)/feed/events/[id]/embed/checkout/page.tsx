import { redirect } from 'next/navigation';

/** Older two-builder path forwards to the canonical event-scoped embed generator. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))) redirect('/feed/events');
 redirect(`/feed/events/${id}/embed`);
}
