'use client';

import dynamic from 'next/dynamic';

const NewMessageScreen = dynamic(
  () =>
    import('@dvnt/app/features/messages/new-message.web').then(
      (m) => m.NewMessageScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <NewMessageScreen />;
}
