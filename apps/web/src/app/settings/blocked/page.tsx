'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/settings/blocked.web').then(
      (m) => m.BlockedScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
