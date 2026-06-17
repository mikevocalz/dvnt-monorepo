'use client';

import dynamic from 'next/dynamic';

const FollowingScreen = dynamic(
  () => import('@dvnt/app/features/profile/following.web').then((m) => m.FollowingScreen),
  { ssr: false },
);

export default function Page() {
  return <FollowingScreen />;
}
