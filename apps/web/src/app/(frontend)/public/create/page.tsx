'use client';

import dynamic from 'next/dynamic';

const CreatePostScreen = dynamic(
  () => import('@dvnt/app/features/create/create-post.web').then((m) => m.CreatePostScreen),
  { ssr: false },
);

export default function Page() {
  return <CreatePostScreen />;
}
