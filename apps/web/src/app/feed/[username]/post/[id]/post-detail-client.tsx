'use client';

import dynamic from 'next/dynamic';

const RouteScreen = dynamic(
  () =>
    import('@dvnt/app/features/post/post-detail').then(
      (m) => m.PostDetailScreen,
    ),
  { ssr: false },
);

export function PostDetailClient() {
  return <RouteScreen />;
}
