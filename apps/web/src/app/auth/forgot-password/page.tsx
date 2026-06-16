'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/auth/screens/ForgotPasswordScreen').then((m) => m.ForgotPasswordScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
