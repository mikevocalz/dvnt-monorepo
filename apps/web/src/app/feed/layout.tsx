'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <WebAppShell>{children}</WebAppShell>;
}
