'use client';

import dynamic from 'next/dynamic';

const StoryEditorScreen = dynamic(
  () =>
    import('@dvnt/app/features/story/story-editor.web').then(
      (m) => m.StoryEditorScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <StoryEditorScreen />;
}
