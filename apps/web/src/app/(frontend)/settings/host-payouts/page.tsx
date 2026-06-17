'use client';

import dynamic from 'next/dynamic';

const HostPayoutsScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/host-payouts.web').then(
      (m) => m.HostPayoutsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <HostPayoutsScreen />;
}
