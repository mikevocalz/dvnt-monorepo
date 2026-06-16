'use client';

import dynamic from 'next/dynamic';

const EventAnalyticsScreen = dynamic(
  () =>
    import('@dvnt/app/features/events/analytics.web').then(
      (m) => m.EventAnalyticsScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <EventAnalyticsScreen />;
}
