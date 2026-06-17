'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/profile/user-profile.web').then((m) => m.UserProfileScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
