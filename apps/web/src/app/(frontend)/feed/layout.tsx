'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
import { PwaInstallPrompt } from '@dvnt/app/components/pwa-install.web';
import { useEffect } from 'react';
import { registerWebPushIfGranted } from '@dvnt/app/lib/web-push';
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // Web push: silently (re)subscribe when permission was already granted.
  useEffect(() => {
    void registerWebPushIfGranted();
  }, []);
  return (
    <WebAppShell>
      {children}
      <PwaInstallPrompt />
    </WebAppShell>
  );
}
