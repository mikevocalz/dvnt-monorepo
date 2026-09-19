'use client';

import dynamic from 'next/dynamic';

const DoorSellScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/door-sell.web').then(
      (m) => m.DoorSellScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <DoorSellScreen />;
}
