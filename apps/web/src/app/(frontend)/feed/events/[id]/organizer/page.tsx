'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

const EventOrganizerScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/organizer.web').then(
      (m) => m.EventOrganizerScreen,
    ),
  { ssr: false },
);
const TicketEmbedOrganizerEntry = dynamic(
  () => import('@dvnt/app/features/events/ui/ticket-embed-settings.web').then((m) => m.TicketEmbedOrganizerEntry),
  { ssr: false },
);

export default function Page() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  return (
    <>
      {process.env.NEXT_PUBLIC_TICKET_EMBED_BUILDER_ENABLED !== 'false' && id ? <TicketEmbedOrganizerEntry eventId={id} /> : null}
      <EventOrganizerScreen />
    </>
  );
}
