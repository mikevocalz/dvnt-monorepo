'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/settings/refunds.web').then(
      (m) => m.RefundsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
