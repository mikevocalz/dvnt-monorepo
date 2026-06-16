'use client';

import dynamic from 'next/dynamic';

const ProfileScreen = dynamic(
  () => import('@dvnt/app/features/profile/profile.web').then((m) => m.ProfileScreen),
  { ssr: false },
);

export default function Page() {
  return <ProfileScreen />;
}
