'use client';

import dynamic from 'next/dynamic';

const CallScreen = dynamic(
  () => import('@dvnt/app/features/call/call.web').then((m) => m.CallScreen),
  { ssr: false },
);

export default function Page() {
  return <CallScreen />;
}
