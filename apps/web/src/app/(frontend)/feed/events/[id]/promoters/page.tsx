'use client';

import dynamic from 'next/dynamic';

const EventPromotersScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/promoters.web').then(
      (m) => m.EventPromotersScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventPromotersScreen />;
}
