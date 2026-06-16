'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/auth/screens/OnboardingScreen').then((m) => m.OnboardingScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
