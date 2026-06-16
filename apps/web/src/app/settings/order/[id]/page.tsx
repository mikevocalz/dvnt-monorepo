'use client';

import dynamic from 'next/dynamic';

const OrderDetailScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/order-detail.web').then(
      (m) => m.OrderDetailScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <OrderDetailScreen />;
}
