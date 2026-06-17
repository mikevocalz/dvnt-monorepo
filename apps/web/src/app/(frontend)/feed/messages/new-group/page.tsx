'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/messages/new-group.web').then(
      (m) => m.NewGroupScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
