'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/search/search.web').then((m) => m.SearchScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
