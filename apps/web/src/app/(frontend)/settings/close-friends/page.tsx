'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/close-friends.web').then(
      (m) => m.CloseFriendsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <RouteScreen />;
}
