'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/activity/activity.web').then((m) => m.ActivityScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
