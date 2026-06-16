'use client';

import dynamic from 'next/dynamic';

const PaymentMethodsScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/payment-methods.web').then(
      (m) => m.PaymentMethodsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <PaymentMethodsScreen />;
}
