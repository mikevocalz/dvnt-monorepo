'use client';

import dynamic from 'next/dynamic';

const LikesCommentsScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/likes-comments.web').then(
      (m) => m.LikesCommentsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <LikesCommentsScreen />;
}
