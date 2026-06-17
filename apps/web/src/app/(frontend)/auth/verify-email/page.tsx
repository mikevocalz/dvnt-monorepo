'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/auth/screens/VerifyEmailScreen').then((m) => m.VerifyEmailScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
