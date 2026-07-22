'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
import { PwaInstallPrompt } from '@dvnt/app/components/pwa-install.web';
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <WebAppShell>
      {children}
      <PwaInstallPrompt />
    </WebAppShell>
  );
}
