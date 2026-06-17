'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/events/checkout-success.web').then(
      (m) => m.CheckoutSuccessScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
