'use client';

import dynamic from 'next/dynamic';

const EventPromoCodesScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/promo-codes.web').then(
      (m) => m.EventPromoCodesScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventPromoCodesScreen />;
}
