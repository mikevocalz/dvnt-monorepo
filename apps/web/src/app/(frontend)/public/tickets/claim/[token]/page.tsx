'use client';

import dynamic from 'next/dynamic';

const CompClaimScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/comp-claim.web').then(
      (m) => m.CompClaimScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <CompClaimScreen />;
}
