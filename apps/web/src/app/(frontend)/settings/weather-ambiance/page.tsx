'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/weather-ambiance.web').then(
      (m) => m.WeatherAmbianceScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
