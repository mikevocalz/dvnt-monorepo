'use client';

import dynamic from 'next/dynamic';

const CheckoutReviewScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/checkout-review.web').then(
      (m) => m.CheckoutReviewScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <CheckoutReviewScreen />;
}
