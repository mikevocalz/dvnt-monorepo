'use client';

import dynamic from 'next/dynamic';

const HostDisputesScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/host-disputes.web').then(
      (m) => m.HostDisputesScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <HostDisputesScreen />;
}
