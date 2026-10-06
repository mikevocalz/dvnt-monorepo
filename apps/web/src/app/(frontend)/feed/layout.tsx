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

function SignedOutRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/');
  }, [router]);
  return <main className="min-h-dvh bg-black" />;
}

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const admission = useAdultAdmissionGate();

  if (admission.status === 'blocked') {
    return <AdultPlatformGate verdict={admission.verdict} />;
  }
  if (admission.status === 'signedOut') return <SignedOutRedirect />;
  if (admission.status !== 'admitted') return <main className="min-h-dvh bg-black" />;
  return <ProtectedShell>{children}</ProtectedShell>;
}
