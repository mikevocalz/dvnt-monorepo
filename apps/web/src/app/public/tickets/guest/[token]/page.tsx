'use client';

import dynamic from 'next/dynamic';

const GuestTicketScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/guest-ticket.web').then(
      (m) => m.GuestTicketScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <GuestTicketScreen />;
}
