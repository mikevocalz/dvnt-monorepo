'use client';

import dynamic from 'next/dynamic';

const DevTelemetryScreen = dynamic(
  () =>
    import('@dvnt/app/features/debug/dev-telemetry.web').then(
      (m) => m.DevTelemetryScreen,
    ),
  { ssr: false },
);

export default function Page() {
  return <DevTelemetryScreen />;
}
