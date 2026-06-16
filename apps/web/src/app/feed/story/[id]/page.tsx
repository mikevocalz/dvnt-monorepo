'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () => import('@dvnt/app/features/story/story-route.web').then((m) => m.StoryRouteScreen),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
