'use client';

import dynamic from 'next/dynamic';

const EventStaffScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/staff.web').then(
      (m) => m.EventStaffScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventStaffScreen />;
}
