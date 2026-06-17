'use client';

import dynamic from 'next/dynamic';

const EditPostScreen = dynamic(
  () =>
    import('@dvnt/app/features/post/edit-post.web').then((m) => m.EditPostScreen),
  { ssr: false },
);

export default function Page() {
  return <EditPostScreen />;
}
