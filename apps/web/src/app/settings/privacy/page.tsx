'use client';

import dynamic from 'next/dynamic';

const PrivacyScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/privacy.web').then(
      (m) => m.PrivacyScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <PrivacyScreen />;
}
