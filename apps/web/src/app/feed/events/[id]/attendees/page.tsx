'use client';

import dynamic from 'next/dynamic';

const AttendeesScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/attendees.web').then(
      (m) => m.AttendeesScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <AttendeesScreen />;
}
