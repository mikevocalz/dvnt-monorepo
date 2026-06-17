'use client';

import dynamic from 'next/dynamic';

const DebugDeeplinksScreen = dynamic(
  () =>
    import('@dvnt/app/features/debug/debug-deeplinks.web').then(
      (m) => m.DebugDeeplinksScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <DebugDeeplinksScreen />;
}
