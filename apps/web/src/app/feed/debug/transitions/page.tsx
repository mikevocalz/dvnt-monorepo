'use client';

import dynamic from 'next/dynamic';

const DebugTransitionsScreen = dynamic(
  () =>
    import('@dvnt/app/features/debug/debug-transitions.web').then(
      (m) => m.DebugTransitionsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <DebugTransitionsScreen />;
}
