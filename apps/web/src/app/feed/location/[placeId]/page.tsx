'use client';

import dynamic from 'next/dynamic';

const LocationDetailScreen = dynamic(
  () =>
    import('@dvnt/app/features/location/location-detail.web').then(
      (m) => m.LocationDetailScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <LocationDetailScreen />;
}
