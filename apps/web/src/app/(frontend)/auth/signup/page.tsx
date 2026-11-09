'use client';

import dynamic from 'next/dynamic';
import { SignupEntry } from '@dvnt/app/components/signup-entry.web';

const Screen = dynamic(
  () => import('@dvnt/app/features/auth/screens/SignupScreen').then((m) => m.SignupScreen),
  { ssr: false },
);

export default function Page() {
  return <SignupEntry><Screen /></SignupEntry>;
}
