'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/install-app.web').then(
      (m) => m.InstallAppScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
