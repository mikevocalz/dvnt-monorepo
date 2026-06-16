'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/auth/screens/SignupScreen').then((m) => m.SignupScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
