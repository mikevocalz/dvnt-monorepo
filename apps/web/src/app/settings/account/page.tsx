'use client';

import dynamic from 'next/dynamic';

const AccountScreen = dynamic(
  () =>
    import('@dvnt/app/features/settings/account.web').then((m) => m.AccountScreen),
  { ssr: false },
);

export default function Page() {
  return <AccountScreen />;
}
