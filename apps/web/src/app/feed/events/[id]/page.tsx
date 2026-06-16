'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/events/event-detail.web').then((m) => m.EventDetailScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
