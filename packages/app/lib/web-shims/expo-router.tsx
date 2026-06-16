/**
 * Web shim for expo-router (apps/web-vite uses TanStack Router). Provides the
 * hooks/components the shared screens call so they RENDER on web; navigation is
 * a no-op for now (wire to Solito/TanStack later). usePathname reflects the real
 * URL so active-state logic works.
 */
import type { ReactNode } from "react";

const noop = () => {};

export const router = {
  push: noop,
  replace: noop,
  back: noop,
  navigate: noop,
  dismiss: noop,
  dismissAll: noop,
  dismissTo: noop,
  setParams: noop,
  reload: noop,
  canGoBack: () => false,
  canDismiss: () => false,
};

export function useRouter() {
  return router;
}
export function usePathname(): string {
  return typeof window !== "undefined" ? window.location.pathname : "/";
}
export function useLocalSearchParams<T = Record<string, string>>(): T {
  return {} as T;
}
export function useGlobalSearchParams<T = Record<string, string>>(): T {
  return {} as T;
}
export function useSegments(): string[] {
  return [];
}
export function useFocusEffect(_effect?: unknown) {}
export function useNavigation() {
  return {
    navigate: noop,
    goBack: noop,
    setOptions: noop,
    dispatch: noop,
    addListener: () => noop,
    canGoBack: () => false,
  };
}
export function useRootNavigation() {
  return null;
}
export function useRootNavigationState() {
  return { key: "web" };
}
export function useNavigationContainerRef() {
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Link = ({ children }: { href?: any; children?: ReactNode }) =>
  (children as any) ?? null;
export const Redirect = (_props: { href?: unknown }) => null;
export const Slot = ({ children }: { children?: ReactNode }) =>
  (children as any) ?? null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const passthrough: any = ({ children }: { children?: ReactNode }) =>
  (children as any) ?? null;
passthrough.Screen = () => null;
export const Stack = passthrough;
export const Tabs = passthrough;

export default { router, Link, Stack, Tabs, Slot, Redirect };
