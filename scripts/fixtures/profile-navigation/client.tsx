'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { SiteChrome } from 'profile-production/site-chrome';
import { ProfileCompletionPopupHost } from 'profile-production/profile-completion-popup-host';
import { WebAppShell } from '@dvnt/app/components/web-app-shell';
import { invalidateProfileCompletion } from '@dvnt/app/lib/profile/profile-completion-invalidation';
import { publishSessionBoundary } from '@dvnt/app/lib/auth/session-lifecycle';
import { useAuthStore, replaceAuth } from './auth';
import { progressBoundary } from './progress';

declare global { interface Window { profileNavigation: any; __profileEvidence: any } }

function PopupHostProbe() {
  useEffect(() => {
    window.__profileEvidence.hostMounts++;
    return () => { window.__profileEvidence.hostUnmounts++; };
  }, []);
  return <ProfileCompletionPopupHost />;
}

export function FixtureRoot({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(true);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    window.profileNavigation = {
      progress: progressBoundary,
      setHostMounted: setMounted,
      getAuth: useAuthStore.getState,
      replaceAuth,
      publishSessionBoundary,
      invalidate: () => invalidateProfileCompletion(useAuthStore.getState().user),
      push: router.push,
      settle: () => progressBoundary.requests.filter(request => !request.settled).forEach(request => request.resolve(progressBoundary.result)),
    };
  }, [router]);
  useEffect(() => { window.__profileEvidence.routes.push(pathname); }, [pathname]);
  return <>
    <SiteChrome>{children}</SiteChrome>
    {mounted && <PopupHostProbe />}
    <details style={{ position: 'fixed', top: 8, right: 8, zIndex: 3000, padding: 8, background: '#171724', maxWidth: 260 }}>
      <summary>Fictional test controls</summary>
      <div style={{ display: 'grid', gap: 8 }}>
        <button onClick={() => { setMounted(false); setTimeout(() => setMounted(true), 100); }}>Remount popup host</button>
        <button onClick={() => { const current = useAuthStore.getState(); replaceAuth({ ...current, user: current.user ? { ...current.user } : null }); }}>Replace equal auth snapshot</button>
        <button onClick={() => { progressBoundary.result = { ...progressBoundary.result, step: 'first_post', required: true, hasPost: false }; invalidateProfileCompletion(useAuthStore.getState().user); }}>Confirm fictional post deletion</button>
        <button onClick={() => { progressBoundary.result = { ...progressBoundary.result, step: 'complete', required: false, hasPhoto: true, hasPost: true }; invalidateProfileCompletion(useAuthStore.getState().user); }}>Restore fictional completion</button>
      </div>
    </details>
  </>;
}

export function Section({ children, name }: { children: React.ReactNode; name: string }) {
  useEffect(() => {
    window.__profileEvidence.sectionMounts.push(name);
    return () => { window.__profileEvidence.sectionUnmounts.push(name); };
  }, [name]);
  return <WebAppShell requireAuth={false}><section data-route-group={name}>{children}</section></WebAppShell>;
}

export function FixturePage({ path }: { path: string }) {
  return <article style={{ padding: 32 }}>
    <h1 data-testid="route-heading">{path}</h1>
    <p>Fictional profile-navigation fixture. No live authentication or API writes.</p>
    <Link href="/settings" prefetch={false}>Fixture settings</Link>{' · '}
    <Link href="/feed" prefetch={false}>Fixture feed</Link>
  </article>;
}
