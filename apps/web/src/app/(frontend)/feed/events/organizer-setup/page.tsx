'use client';

import dynamic from 'next/dynamic';

const OrganizerSetupScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/organizer-setup.web').then(
      (m) => m.OrganizerSetupScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <OrganizerSetupScreen />;
}
