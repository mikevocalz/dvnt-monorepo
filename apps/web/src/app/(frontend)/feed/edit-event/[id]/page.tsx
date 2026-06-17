'use client';

import dynamic from 'next/dynamic';

const EventEditScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/event-edit.web').then(
      (m) => m.EventEditScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventEditScreen />;
}
