'use client';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
export default function EventsLayout({ children }: { children: React.ReactNode }) {
  // Public surface: same events screen for logged-out + logged-in visitors —
  // don't redirect anonymous users away. What each sees is gated inside the
  // screen + server-side RLS, not by the shell.
  return <WebAppShell requireAuth={false}>{children}</WebAppShell>;
}
