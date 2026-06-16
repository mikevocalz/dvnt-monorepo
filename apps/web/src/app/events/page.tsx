'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(
  () => import('@dvnt/app/features/events/events-list').then((m) => m.EventsListScreen),
  { ssr: false },
);
export default function Page() {
  return <Screen />;
}
