'use client';
import dynamic from 'next/dynamic';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
import { useEffect } from 'react';
import { registerWebPushIfGranted } from '@dvnt/app/lib/web-push';

// Mounted once inside the authenticated shell so consent changes, account
// switches and explicit revocations sync without opening the privacy page.
const MemberProximitySync = dynamic(
  () => import('@dvnt/app/components/member-proximity-sync.web')
    .then((module) => module.MemberProximitySync),
  { ssr: false },
);

const PwaInstallPrompt = dynamic(
  () =>
    import('@dvnt/app/components/pwa-install.web').then(
      (module) => module.PwaInstallPrompt,
    ),
  { ssr: false },
);

const IncomingCallOverlay = dynamic(
  () =>
    import('@dvnt/app/features/call/ui/incoming-call-overlay.web').then(
      (module) => module.IncomingCallOverlay,
    ),
  { ssr: false },
);

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void registerWebPushIfGranted();
  }, []);
  return (
    <WebAppShell>
      {children}
      <MemberProximitySync />
      <PwaInstallPrompt />
      <IncomingCallOverlay />
    </WebAppShell>
  );
}
