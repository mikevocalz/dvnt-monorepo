'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <WebAppShell>{children}</WebAppShell>;
}
