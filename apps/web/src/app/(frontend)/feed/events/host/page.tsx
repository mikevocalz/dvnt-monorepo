'use client';

import dynamic from 'next/dynamic';

const HostScreen = dynamic(
  () => import('@dvnt/app/features/events/host.web').then((m) => m.HostScreen),
  { ssr: false },
);

export default function Page() {
  return <HostScreen />;
}
