'use client';

import dynamic from 'next/dynamic';

const HostBankVerificationScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/host-bank-verification.web').then(
      (m) => m.HostBankVerificationScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <HostBankVerificationScreen />;
}
