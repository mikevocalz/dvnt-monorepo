'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/settings/purchases.web').then(
      (m) => m.PurchasesScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
