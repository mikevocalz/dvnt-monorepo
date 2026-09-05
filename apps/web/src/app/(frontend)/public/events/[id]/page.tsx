import type { Metadata } from 'next';
import {
  buildEventMetadata,
  fetchShareEvent,
} from '@/app/(frontend)/api/og/event/_lib/event-og';
import { EventDetailClient } from './event-detail-client';

/**
 * Server-rendered OG/Twitter metadata so SHARED event links unfurl with the
 * per-event themed card (/api/og/event/[id]) — the interactive detail UI
 * still loads client-side (WS-7 share moment). Private / draft events get
 * generic DVNT metadata; nothing leaks into a cold unfurl.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await fetchShareEvent(id);
  return buildEventMetadata(event, `/public/events/${id}`);
}

export default function Page() {
  return <EventDetailClient />;
}
