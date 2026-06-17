'use client';

import dynamic from 'next/dynamic';

const StoryCreateScreen = dynamic(
  () => import('@dvnt/app/features/story/story-create.web').then((m) => m.StoryCreateScreen),
  { ssr: false },
);

export default function Page() {
  return <StoryCreateScreen />;
}
