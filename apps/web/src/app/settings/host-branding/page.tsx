'use client';

import dynamic from 'next/dynamic';

const HostBrandingScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/host-branding.web').then(
      (m) => m.HostBrandingScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <HostBrandingScreen />;
}
