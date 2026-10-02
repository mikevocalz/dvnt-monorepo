'use client';
import dynamic from 'next/dynamic';
import { useRouter } from 'solito/navigation';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
import { useAdultAdmissionGate } from '@dvnt/app/lib/hooks/use-verified-admission';
import { useEffect } from 'react';
import { registerWebPushIfGranted } from '@dvnt/app/lib/web-push';

const AdultPlatformGate = dynamic(
  () =>
    import('@dvnt/app/components/adult-platform-gate.web').then(
      (module) => module.AdultPlatformGate,
    ),
  { ssr: false },
);

const MemberProximitySync = dynamic(
  () =>
    import('@dvnt/app/components/member-proximity-sync.web').then(
      (module) => module.MemberProximitySync,
    ),
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

function ProtectedShell({ children }: { children: React.ReactNode }) {
  // Proximity publication is a post-mount side effect and must not inflate the
  // protected shell's first-load bundle.
  // Web push: silently (re)subscribe when permission was already granted.
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

/**
 * A signed-out visitor on /feed used to reach the redirect inside WebAppShell.
 * The shell no longer mounts for them, so the redirect lives here instead.
 */
function SignedOutRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return <main className="min-h-dvh bg-black" />;
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const admission = useAdultAdmissionGate();

  // Keep blocked/newly in-scope accounts outside the app shell entirely. This
  // prevents a content flash and avoids starting realtime/push/location work
  // before the adult-admission boundary is satisfied.
  //
  // Only `admitted` mounts the shell. A pending or errored admission read holds
  // here rather than falling through, so a failed read cannot open the adult
  // app on a cold start or an offline device.
  if (admission.status === 'blocked') {
    return <AdultPlatformGate verdict={admission.verdict} />;
  }
  if (admission.status === 'signedOut') return <SignedOutRedirect />;
  if (admission.status !== 'admitted') return <main className="min-h-dvh bg-black" />;
  return <ProtectedShell>{children}</ProtectedShell>;
}
