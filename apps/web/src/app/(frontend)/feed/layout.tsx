'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
import { PwaInstallPrompt } from '@dvnt/app/components/pwa-install.web';
import { IncomingCallOverlay } from '@dvnt/app/features/call/ui/incoming-call-overlay.web';
import { AdultPlatformGate } from '@dvnt/app/components/adult-platform-gate.web';
import { useVerifiedAdmission } from '@dvnt/app/lib/hooks/use-verified-admission';
import { useEffect } from 'react';
import { registerWebPushIfGranted } from '@dvnt/app/lib/web-push';
import { useSyncMemberProximityPresence } from '@dvnt/app/lib/hooks/use-member-proximity';

function ProtectedShell({ children }: { children: React.ReactNode }) {
  useSyncMemberProximityPresence();
  // Web push: silently (re)subscribe when permission was already granted.
  useEffect(() => {
    void registerWebPushIfGranted();
  }, []);
  return (
    <WebAppShell>
      {children}
      <PwaInstallPrompt />
      <IncomingCallOverlay />
    </WebAppShell>
  );
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { data: adultAdmission, isLoading } = useVerifiedAdmission();

  // Keep blocked/newly in-scope accounts outside the app shell entirely. This
  // prevents a content flash and avoids starting realtime/push/location work
  // before the adult-admission boundary is satisfied.
  if (isLoading) return <main className="min-h-dvh bg-black" />;
  if (adultAdmission?.state === 'blocked') {
    return <AdultPlatformGate verdict={adultAdmission} />;
  }
  return <ProtectedShell>{children}</ProtectedShell>;
}
