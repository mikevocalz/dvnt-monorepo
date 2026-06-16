'use client';

import dynamic from 'next/dynamic';

const VideoRoomsScreen = dynamic(
  () => import('@dvnt/app/features/call/video-rooms.web').then((m) => m.VideoRoomsScreen),
  { ssr: false },
);

export default function Page() {
  return <VideoRoomsScreen />;
}
