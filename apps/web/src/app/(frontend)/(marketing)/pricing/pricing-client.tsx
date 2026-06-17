'use client';

import dynamic from 'next/dynamic';

// Client-only: PricingPage pulls the auth store, which imports auth-client.web
// (reads window at module load). Load it ssr:false so it never runs on the
// server. The dark shell prevents a flash before it mounts.
const PricingPage = dynamic(
  () => import('@/components/pricing/pricing-page').then((m) => m.PricingPage),
  { ssr: false, loading: () => <div style={{ minHeight: '100vh', background: '#02030A' }} /> },
);

export default function PricingClient() {
  return <PricingPage />;
}
