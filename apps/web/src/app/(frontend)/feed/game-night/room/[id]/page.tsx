'use client';

import dynamic from 'next/dynamic';

const GameNightRoomScreen = dynamic(
  () =>
    import('@dvnt/app/features/game-night/screens/room.web').then(
      (m) => m.GameNightRoomScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <GameNightRoomScreen />;
}
