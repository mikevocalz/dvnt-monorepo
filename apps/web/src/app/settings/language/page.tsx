'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/language.web').then(
      (m) => m.LanguageScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
