'use client';

import dynamic from 'next/dynamic';

const PromoterSelfScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/promoter-self.web').then(
      (m) => m.PromoterSelfScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <PromoterSelfScreen />;
}
