'use client';

import dynamic from 'next/dynamic';

const NotFoundScreen = dynamic(
  () => import('@dvnt/app/features/routes/screens/+not-found'),
  { ssr: false },
);

export default function NotFound() {
  return <NotFoundScreen />;
}
