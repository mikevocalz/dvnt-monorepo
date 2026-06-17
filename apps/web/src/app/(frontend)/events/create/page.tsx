'use client';
import dynamic from 'next/dynamic';
const Screen = dynamic(
  () => import('@dvnt/app/features/events/event-create').then((m) => m.CreateEventScreen),
  { ssr: false },
);
export default function Page() {
  return <Screen />;
}
