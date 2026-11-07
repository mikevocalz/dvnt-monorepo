'use client';
import { hydrateAuthProfile } from "@dvnt/app/lib/auth/hydrate-auth-profile";

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { syncAuthUser } from '@dvnt/app/lib/api/privileged';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { resumeAuthSession } from '@dvnt/app/lib/auth-client';
import { isStaffReturnTo, loginPathWithReturn, readReturnToFromUrl, welcomePathWithReturn } from '@dvnt/app/lib/auth/return-to';
import { captureAuthContinuation } from '@dvnt/app/lib/auth/continuation-guard';

/**
 * OAuth landing (Google → Better Auth → here). The session cookie is already
 * set by the /api/auth proxy; this page mirrors the email-login tail:
 * syncAuthUser → setUser → welcome flow (first time) or feed.
 */
export default function SocialCallbackPage() {
  const router = useRouter();
  const search = useSearchParams()?.toString() ?? '';

  useEffect(() => {
    let active = true;
    let continuation: ReturnType<typeof captureAuthContinuation> | undefined;
    const entryUrl = window.location.href;
    const stillCurrent = () => active && window.location.href === entryUrl && (!continuation || continuation.isCurrent());
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        // Failed OAuth may leave the previous account's cookie intact.
        if (params.has('error') || params.has('error_description') || params.has('error_code')) {
          throw new Error('External sign-in was not completed');
        }
        if (!(await resumeAuthSession())) throw new Error('No new sign-in session');
        if (!stillCurrent()) return;
        continuation = captureAuthContinuation();
        const profile: any = await syncAuthUser();
        if (!stillCurrent()) return;
        if (!profile) throw new Error('no profile');
        continuation.release();
        useAuthStore.getState().setUser(hydrateAuthProfile(profile));
        const welcomeDone =
          typeof localStorage !== 'undefined' &&
          !!localStorage.getItem(`dvnt-welcome-${profile.id}`);
        const destination = readReturnToFromUrl('/feed');
        router.replace(welcomeDone || isStaffReturnTo(destination) ? destination : welcomePathWithReturn(destination));
      } catch {
        if (stillCurrent()) router.replace(loginPathWithReturn(readReturnToFromUrl('')));
      } finally {
        continuation?.release();
      }
    })();
    return () => { active = false; continuation?.release(); };
  }, [router, search]);

  return (
    <main className="min-h-[100dvh] bg-[#02030A] flex items-center justify-center">
      <span className="text-white/50">Signing you in…</span>
    </main>
  );
}
