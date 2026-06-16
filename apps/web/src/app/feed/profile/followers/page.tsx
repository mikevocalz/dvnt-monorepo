'use client';

import dynamic from 'next/dynamic';

const FollowersScreen = dynamic(
  () => import('@dvnt/app/features/profile/followers.web').then((m) => m.FollowersScreen),
  { ssr: false },
);

export default function Page() {
  return <FollowersScreen />;
}
