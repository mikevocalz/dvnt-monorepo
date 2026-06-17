'use client';

import dynamic from 'next/dynamic';

const SneakyLynkCreateScreen = dynamic(
  () =>
    import('@dvnt/app/features/sneaky-lynk/create.web').then(
      (m) => m.SneakyLynkCreateScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <SneakyLynkCreateScreen />;
}
