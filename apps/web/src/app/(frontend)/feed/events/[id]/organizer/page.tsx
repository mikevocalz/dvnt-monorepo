'use client';

import dynamic from 'next/dynamic';

const EventOrganizerScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/organizer.web').then(
      (m) => m.EventOrganizerScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventOrganizerScreen />;
}
