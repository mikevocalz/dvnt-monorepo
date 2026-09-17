'use client';

import dynamic from 'next/dynamic';

const GameNightLobbyScreen = dynamic(
  () =>
    import('@dvnt/app/features/game-night/screens/lobby.web').then(
      (m) => m.GameNightLobbyScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <GameNightLobbyScreen />;
}
