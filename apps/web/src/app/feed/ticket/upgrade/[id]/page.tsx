'use client';

import dynamic from 'next/dynamic';

const TicketUpgradeScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/ticket-upgrade.web').then(
      (m) => m.TicketUpgradeScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <TicketUpgradeScreen />;
}
