'use client';

import dynamic from 'next/dynamic';
import { RedirectIfAuthed } from '@dvnt/app/components/web-auth-redirect';
import { readReturnToFromUrl } from '@dvnt/app/lib/auth/return-to';

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
      <RedirectIfAuthed to={readReturnToFromUrl('/feed')} />
      <RouteScreen />
    </>
  );
}
