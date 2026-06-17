'use client';

import dynamic from 'next/dynamic';

const Screen = dynamic(
  () =>
    import('@dvnt/app/features/events/my-tickets.web').then(
      (m) => m.MyTicketsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <Screen />;
}
