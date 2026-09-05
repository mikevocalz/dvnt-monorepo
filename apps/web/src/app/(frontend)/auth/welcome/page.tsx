'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/auth/screens/WelcomeScreen.web').then(
      (m) => m.WelcomeScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
