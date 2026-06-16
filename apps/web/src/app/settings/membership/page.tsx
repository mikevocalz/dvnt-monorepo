'use client';

import dynamic from 'next/dynamic';

// Universal membership/paywall screen. Client-only (ssr:false): it reads the
// auth store + entitlements (which touch window/storage on the client).
const MembershipScreen = dynamic(
  () =>
    import('@dvnt/app/features/screens/membership/MembershipScreen').then(
      (m) => m.MembershipScreen,
    ),
  { ssr: false, loading: () => <div style={{ minHeight: '100vh', background: '#02030A' }} /> },
);

export default function Page() {
  return <MembershipScreen />;
}
