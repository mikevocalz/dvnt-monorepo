'use client';

import dynamic from 'next/dynamic';

const DebugScreen = dynamic(
  () =>
    import('@dvnt/app/features/debug/debug.web').then((m) => m.DebugScreen),
  { ssr: false },
);

export default function Page() {
  return <DebugScreen />;
}
