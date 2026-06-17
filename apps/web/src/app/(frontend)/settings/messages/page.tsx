'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/messages.web').then(
      (m) => m.MessagesSettingsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
