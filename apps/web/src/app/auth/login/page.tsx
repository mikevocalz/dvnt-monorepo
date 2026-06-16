'use client';

import dynamic from 'next/dynamic';
import { RedirectIfAuthed } from '@dvnt/app/components/web-auth-redirect';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/auth/screens/LoginScreen').then(
      (m) => m.LoginScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return (
    <>
      <RedirectIfAuthed />
      <RouteScreen />
    </>
  );
}
