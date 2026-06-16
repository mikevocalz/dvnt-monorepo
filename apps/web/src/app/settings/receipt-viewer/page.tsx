'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/settings/receipt-viewer.web').then(
      (m) => m.ReceiptViewerScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
