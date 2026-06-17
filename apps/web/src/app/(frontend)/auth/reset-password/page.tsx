'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/auth/screens/ResetPasswordScreen').then((m) => m.ResetPasswordScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
