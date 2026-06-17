'use client';

import dynamic from 'next/dynamic';

const ChatScreen = dynamic(
  () => import('@dvnt/app/features/messages/chat.web').then((m) => m.ChatScreen),
  { ssr: false },
);

export default function Page() {
  return <ChatScreen />;
}
