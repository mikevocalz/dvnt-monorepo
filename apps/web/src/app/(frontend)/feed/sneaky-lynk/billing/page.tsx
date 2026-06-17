'use client';

import dynamic from 'next/dynamic';

const SneakyLynkBillingScreen = dynamic(
  () =>
    import('@dvnt/app/features/sneaky-lynk/billing.web').then(
      (m) => m.SneakyLynkBillingScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <SneakyLynkBillingScreen />;
}
