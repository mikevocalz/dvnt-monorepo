'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { syncAuthUser } from '@dvnt/app/lib/api/privileged';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';

/**
 * OAuth landing (Google → Better Auth → here). The session cookie is already
 * set by the /api/auth proxy; this page mirrors the email-login tail:
 * syncAuthUser → setUser → welcome flow (first time) or feed.
 */
export default function SocialCallbackPage() {
  const router = useRouter();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const profile: any = await syncAuthUser();
        if (!profile) throw new Error('no profile');
        useAuthStore.getState().setUser({
          id: profile.id,
          email: profile.email,
          username: profile.username,
          name: profile.name,
          avatar: profile.avatar || '',
          bio: profile.bio || '',
          website: profile.website || '',
          location: profile.location || '',
          hashtags: profile.hashtags || [],
          isVerified: profile.isVerified,
          postsCount: profile.postsCount,
          followersCount: profile.followersCount,
          followingCount: profile.followingCount,
        });
        const welcomeDone =
          typeof localStorage !== 'undefined' &&
          !!localStorage.getItem(`dvnt-welcome-${profile.id}`);
        router.replace(welcomeDone ? '/feed' : '/auth/welcome');
      } catch {
        router.replace('/auth/login');
      }
    })();
  }, [router]);

  return (
    <main className="min-h-[100dvh] bg-[#02030A] flex items-center justify-center">
      <span className="text-white/50">Signing you in…</span>
    </main>
  );
}
