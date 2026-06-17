'use client';

import dynamic from 'next/dynamic';

const HostPaymentsScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/host-payments.web').then(
      (m) => m.HostPaymentsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <HostPaymentsScreen />;
}
