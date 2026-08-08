import type { Metadata } from 'next';
import {
  buildEventMetadata,
  fetchShareEventBySlug,
} from '@/app/(frontend)/api/og/event/_lib/event-og';
import { EventDetailClient } from './event-detail-client';

/**
 * Server-rendered OG/Twitter metadata so SHARED event links unfurl with the
 * per-event themed card (/api/og/event/[id]) — the interactive detail UI
 * still loads client-side (WS-7 share moment). The slug is title-derived
 * (events have no slug column), resolved the same way the client screen
 * does. Private / draft events get generic DVNT metadata.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await fetchShareEventBySlug(decodeURIComponent(slug));
  return buildEventMetadata(event, `/events/${slug}`);
}

export default function Page() {
  return <EventDetailClient />;
}
