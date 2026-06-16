'use client';

import dynamic from 'next/dynamic';

const EventScannerScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/scanner.web').then(
      (m) => m.EventScannerScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventScannerScreen />;
}
