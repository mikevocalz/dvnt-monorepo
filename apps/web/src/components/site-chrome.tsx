'use client';
/**
 * SiteChrome — the single, persistent web shell, mounted once in the Next root
 * layout WRAPPING the page tree: header + {children} + footer. Living at the
 * root, it never unmounts on navigation, so the header/footer don't remount or
 * jump when crossing route-group boundaries.
 *
 * Chrome by route + auth:
 *  - /auth/*                         → bare (just children; the auth flow has no chrome)
 *  - authed app surfaces, logged in  → app WebAppHeader + WebTabBar (like the feed), no marketing footer
 *  - everything else                 → marketing GlassHeader + Footer (turn-to-glass on /)
 *
 * GlassHeader/Footer are browser-only (Reanimated) so they're loaded ssr:false,
 * matching how the marketing pages always loaded them. WebAppHeader/WebTabBar
 * SSR fine. The header/footer are position:fixed / in-flow respectively; content
 * top-padding still lives in each page/layout.
 */
import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { usePathname } from 'solito/navigation';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { AppShell } from '@dvnt/app/components/app-shell';

const GlassHeader = dynamic(
  () =>
    import('@dvnt/app/features/screens/landing/sections/GlassHeader').then(
      (m) => m.GlassHeader,
    ),
  { ssr: false },
);
const Footer = dynamic(
  () =>
    import('@dvnt/app/features/screens/landing/sections/Footer').then(
      (m) => m.Footer,
    ),
  { ssr: false },
);

// Route prefixes that use the logged-in app chrome (the AppShell rail), no
// marketing header/footer. The blog (/blog, /posts) is in the rail nav, so when
// signed in it stays INSIDE the shell instead of flipping to the marketing
// GlassHeader (which also wrongly showed a "Login" button while authed).
const APP_SURFACES = [
  '/feed',
  '/notifications',
  '/profile',
  '/settings',
  '/video',
  '/events',
  '/blog',
  '/posts',
];

const isAppSurface = (path: string) =>
  APP_SURFACES.some((p) => path === p || path.startsWith(p + '/'));

export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  // Supabase JWT bridge for the WEB app. Mobile does this in its Expo Router
  // _layout; the web never did, so its supabase client stayed `anon` and EVERY
  // direct write (events, stories, messages, follows, tags…) failed with
  // "permission denied for table …". Mint the authenticated JWT once signed in,
  // and refresh on an interval so it stays fresh across a long-lived tab.
  // Additive + silent — never blocks anything.
  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return;
    const ensure = () =>
      import('@dvnt/app/lib/auth/supabase-jwt')
        .then((m) => m.ensureSupabaseJwt())
        .catch(() => {});
    ensure();
    const t = setInterval(ensure, 4 * 60 * 1000);
    return () => clearInterval(t);
  }, [hasHydrated, isAuthenticated]);

  // Auth flow renders without site chrome.
  if (pathname.startsWith('/auth')) return <>{children}</>;

  // App surfaces show the app chrome once we know the visitor is authed.
  // (WebAppShell still redirects logged-out users away from auth-only surfaces;
  // /events stays public and falls through to the marketing shell below.)
  if (isAppSurface(pathname) && hasHydrated && isAuthenticated) {
    // The persistent 3-column shell (PROMPT 13 §1): left rail + center + right
    // aside on desktop, the bottom tab bar on phones. AppShell switches by
    // breakpoint and owns the nav, replacing the old floating header + tab bar.
    return <AppShell>{children}</AppShell>;
  }

  // Marketing / landing / public + logged-out app surfaces.
  return (
    <>
      <GlassHeader webWindowScroll={pathname === '/'} />
      {children}
      <Footer />
    </>
  );
}
