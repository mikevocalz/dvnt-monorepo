'use client';

import dynamic from 'next/dynamic';

const MessagesScreen = dynamic(
  () =>
    import('@dvnt/app/features/messages/messages.web').then(
      (m) => m.MessagesScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <MessagesScreen />;
}
