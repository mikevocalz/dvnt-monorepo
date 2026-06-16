'use client';

import dynamic from 'next/dynamic';

const EventCommentsScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/event-comments.web').then(
      (m) => m.EventCommentsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventCommentsScreen />;
}
