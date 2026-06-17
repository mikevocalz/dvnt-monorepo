'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/profile/edit-profile.web').then((m) => m.EditProfileScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
