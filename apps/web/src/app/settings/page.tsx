'use client';

import dynamic from 'next/dynamic';

const SettingsHomeScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/settings-home.web').then(
      (m) => m.SettingsHomeScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <SettingsHomeScreen />;
}
