'use client';

import dynamic from 'next/dynamic';

const TicketDetailScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/ticket-detail.web').then(
      (m) => m.TicketDetailScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <TicketDetailScreen />;
}
