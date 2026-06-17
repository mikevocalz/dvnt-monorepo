'use client';

import dynamic from 'next/dynamic';

const RefundRequestScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/refund-request.web').then(
      (m) => m.RefundRequestScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RefundRequestScreen />;
}
