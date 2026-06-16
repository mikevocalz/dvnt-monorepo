'use client';

import dynamic from 'next/dynamic';

const PaymentsScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/payments.web').then(
      (m) => m.PaymentsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <PaymentsScreen />;
}
