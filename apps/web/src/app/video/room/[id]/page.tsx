'use client';

import dynamic from 'next/dynamic';

const VideoRoomScreen = dynamic(
  () => import('@dvnt/app/features/call/video-room.web').then((m) => m.VideoRoomScreen),
  { ssr: false },
);

export default function Page() {
  return <VideoRoomScreen />;
}
