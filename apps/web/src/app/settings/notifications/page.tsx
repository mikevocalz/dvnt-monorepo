'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/notifications.web').then(
      (m) => m.NotificationsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
