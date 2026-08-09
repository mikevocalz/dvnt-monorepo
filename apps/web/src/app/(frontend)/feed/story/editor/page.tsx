'use client';

import dynamic from 'next/dynamic';

// The story editor and the story composer are now ONE screen: the create
// screen hosts the editor rail + tool sheets inline and shares directly. This
// legacy /feed/story/editor route renders the same unified screen so any old
// links keep working.
const StoryCreateScreen = dynamic(
  () =>
    import('@dvnt/app/features/story/story-create.web').then(
      (m) => m.StoryCreateScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <StoryCreateScreen />;
}
