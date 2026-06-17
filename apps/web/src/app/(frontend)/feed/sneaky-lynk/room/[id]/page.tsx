'use client';

import dynamic from 'next/dynamic';

const SneakyLynkRoomScreen = dynamic(
  () =>
    import('@dvnt/app/features/sneaky-lynk/room.web').then(
      (m) => m.SneakyLynkRoomScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <SneakyLynkRoomScreen />;
}
