'use client';

import dynamic from 'next/dynamic';

const EventLiveScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/event-live.web').then(
      (m) => m.EventLiveScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventLiveScreen />;
}
