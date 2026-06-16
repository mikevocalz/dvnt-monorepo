'use client';

import dynamic from 'next/dynamic';

const HostTransactionsScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/host-transactions.web').then(
      (m) => m.HostTransactionsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <HostTransactionsScreen />;
}
