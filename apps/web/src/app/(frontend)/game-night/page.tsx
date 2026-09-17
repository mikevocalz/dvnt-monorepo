'use client';

import dynamic from 'next/dynamic';

const GameNightRoomsScreen = dynamic(
  () =>
    import('@dvnt/app/features/game-night/screens/rooms-list.web').then(
      (m) => m.GameNightRoomsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <GameNightRoomsScreen />;
}
