'use client';

/**
 * expo-router → Next bridge (web). The shared screens import from `expo-router`;
 * on native that's the real router, on web (apps/web) we alias to this, which
 * maps the expo-router API onto `next/navigation`. This is what makes the shared
 * universal screens render on Next instead of throwing "Couldn't find a
 * navigation object".
 */
import React, { useEffect, type ReactNode } from 'react';
import NextLink from 'next/link';
import {
  useRouter as useNextRouter,
  usePathname as useNextPathname,
  useParams,
  useSearchParams,
} from 'next/navigation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Href = any;

function toHref(href: Href): string {
  if (typeof href === 'string') return href;
  if (href && typeof href === 'object') {
    const path = href.pathname ?? href.href ?? '/';
    const params = (href.params ?? {}) as Record<string, string>;
    const qs = new URLSearchParams(params).toString();
    return qs ? `${path}?${qs}` : path;
  }
  return '/';
}

export function useRouter() {
  const r = useNextRouter();
  return {
    push: (href: Href) => r.push(toHref(href)),
    replace: (href: Href) => r.replace(toHref(href)),
    navigate: (href: Href) => r.push(toHref(href)),
    back: () => r.back(),
    dismiss: () => r.back(),
    dismissAll: () => {},
    dismissTo: (href: Href) => r.replace(toHref(href)),
    setParams: () => {},
    reload: () => r.refresh(),
    canGoBack: () => true,
    canDismiss: () => false,
  };
}

// Imperative router (used outside components). Next has no out-of-React router,
// so navigate via the browser. Hook-based useRouter() above does SPA nav.
function imperativeNav(href: Href, replace = false) {
  if (typeof window === 'undefined') return;
  const url = toHref(href);
  if (replace) window.location.replace(url);
  else window.location.assign(url);
}
export const router = {
  push: (href: Href) => imperativeNav(href),
  replace: (href: Href) => imperativeNav(href, true),
  navigate: (href: Href) => imperativeNav(href),
  back: () => typeof window !== 'undefined' && window.history.back(),
  dismiss: () => typeof window !== 'undefined' && window.history.back(),
  dismissAll: () => {},
  dismissTo: (href: Href) => imperativeNav(href, true),
  setParams: () => {},
  reload: () => typeof window !== 'undefined' && window.location.reload(),
  canGoBack: () => true,
  canDismiss: () => false,
};

export function usePathname(): string {
  return useNextPathname() ?? '/';
}
export function useLocalSearchParams<T = Record<string, string>>(): T {
  const params = useParams();
  const search = useSearchParams();
  const obj: Record<string, string> = {};
  search?.forEach((v, k) => {
    obj[k] = v;
  });
  return { ...(params as Record<string, string>), ...obj } as T;
}
export const useGlobalSearchParams = useLocalSearchParams;

export function useSegments(): string[] {
  return (useNextPathname() ?? '/').split('/').filter(Boolean);
}

export function useFocusEffect(effect: () => void | (() => void)) {
  // Web has no tab focus/blur lifecycle — run once on mount, honor cleanup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => effect?.(), []);
}

export function useNavigation() {
  const r = useNextRouter();
  return {
    navigate: (href: Href) => r.push(toHref(href)),
    goBack: () => r.back(),
    setOptions: () => {},
    addListener: () => () => {},
    dispatch: () => {},
    canGoBack: () => true,
  };
}

export function Redirect({ href }: { href: Href }) {
  const r = useNextRouter();
  useEffect(() => {
    r.replace(toHref(href));
  }, [href, r]);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Link({ href, children, asChild, ...rest }: any) {
  return (
    <NextLink href={toHref(href)} {...rest}>
      {children}
    </NextLink>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Passthrough: any = ({ children }: { children?: ReactNode }) => <>{children}</>;
Passthrough.Screen = () => null;
Passthrough.Protected = ({ children }: { children?: ReactNode }) => <>{children}</>;
export const Stack = Passthrough;
export const Tabs = Passthrough;
export const Slot = ({ children }: { children?: ReactNode }) => <>{children}</>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withLayoutContext(_Nav: any) {
  return Passthrough;
}

// expo-router's default 404 screen.
export function Unmatched() {
  return (
    <main
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        color: '#fff',
        background: '#02030A',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Page not found</h1>
      <a href="/" style={{ color: '#3FDCFF', fontWeight: 600 }}>
        Go home
      </a>
    </main>
  );
}

export const ErrorBoundary = ({ children }: { children?: ReactNode }) => (
  <>{children}</>
);
export const SplashScreen = {
  hideAsync: async () => {},
  preventAutoHideAsync: async () => {},
};

export default {
  router,
  useRouter,
  usePathname,
  useLocalSearchParams,
  useGlobalSearchParams,
  useSegments,
  useFocusEffect,
  useNavigation,
  Redirect,
  Link,
  Stack,
  Tabs,
  Slot,
  withLayoutContext,
};
