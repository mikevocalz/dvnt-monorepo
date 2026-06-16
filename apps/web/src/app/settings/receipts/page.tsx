'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/settings/receipts.web').then(
      (m) => m.ReceiptsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
