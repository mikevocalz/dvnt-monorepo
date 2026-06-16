'use client';

import dynamic from 'next/dynamic';

const DebugOtaScreen = dynamic(
  () =>
    import('@dvnt/app/features/debug/debug-ota.web').then(
      (m) => m.DebugOtaScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <DebugOtaScreen />;
}
