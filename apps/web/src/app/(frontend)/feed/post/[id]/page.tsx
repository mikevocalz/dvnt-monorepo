'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/post/post-detail.web').then((m) => m.PostDetailScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
