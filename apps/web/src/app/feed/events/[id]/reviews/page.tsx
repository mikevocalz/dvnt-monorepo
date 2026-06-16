'use client';

import dynamic from 'next/dynamic';

const EventReviewsScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/reviews.web').then(
      (m) => m.EventReviewsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventReviewsScreen />;
}
