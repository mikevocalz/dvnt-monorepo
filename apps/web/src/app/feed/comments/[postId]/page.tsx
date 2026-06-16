'use client';

import dynamic from 'next/dynamic';

const CommentsScreen = dynamic(
  () =>
    import('@dvnt/app/features/comments/comments').then(
      (m) => m.CommentsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <CommentsScreen />;
}
