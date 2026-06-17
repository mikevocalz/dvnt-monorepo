'use client';

import dynamic from 'next/dynamic';

const CommentRepliesScreen = dynamic(
  () =>
    import('@dvnt/app/features/comments/comment-replies').then(
      (m) => m.CommentRepliesScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <CommentRepliesScreen />;
}
