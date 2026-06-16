'use client';

import dynamic from 'next/dynamic';

const LocationPickerScreen = dynamic(
  () =>
    import('@dvnt/app/features/location/location-picker.web').then(
      (m) => m.LocationPickerScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <LocationPickerScreen />;
}
