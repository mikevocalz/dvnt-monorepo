'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/settings/archived.web').then((m) => m.ArchivedScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
