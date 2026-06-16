'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/theme.web').then(
      (m) => m.ThemeScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
