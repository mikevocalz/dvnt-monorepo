/**
 * Link Engine
 * Central deep link processing: parse → policy → resolve → navigate.
 * Handles https://dvntapp.live/*, dvnt://*, and Expo dev URLs.
 */

import { router } from "expo-router";
import { normalizeLynkRoomId } from "@dvnt/app/features/sneaky-lynk/room-links";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  useDeepLinkStore,
  type ParsedDeepLink,
} from "@dvnt/app/lib/stores/deep-link-store";
import {
  matchRoute,
  buildRouterPath,
  type RouteEntry,
} from "./route-registry";

// ── Constants ────────────────────────────────────────────────────────

const PRODUCTION_DOMAIN = "dvntapp.live";
const CUSTOM_SCHEME = "dvnt";
const WWW_DOMAIN = `www.${PRODUCTION_DOMAIN}`;
const DEV_CLIENT_BOOTSTRAP_MARKERS =
  /^(?:(?:exp\+dvnt|dvnt):\/\/|\/?)expo-development-client(?:[/?#]|$)/i;

// ── 1) parseIncomingUrl ──────────────────────────────────────────────

/**
 * Parse any incoming URL into a normalized ParsedDeepLink.
 * Supports:
 *  - https://dvntapp.live/*
 *  - https://www.dvntapp.live/*
 *  - dvnt://*
 *  - exp://... (dev only)
 */
export function parseIncomingUrl(url: string): ParsedDeepLink | null {
  if (!url || typeof url !== "string") return null;
  if (DEV_CLIENT_BOOTSTRAP_MARKERS.test(url)) return null;

  try {
    let path = "";
    let params: Record<string, string> = {};

    const isDev = typeof __DEV__ !== "undefined" && __DEV__;
    if (/[\\\u0000-\u001f\u007f]/.test(url) || url.startsWith("//")) return null;

    // Do not let URL normalization turn a different room/path into this one.
    if (/\/(?:\.|%2e){1,2}(?=\/|[?#]|$)/i.test(url)) return null;

    // Handle dvnt:// scheme
    if (url.startsWith(`${CUSTOM_SCHEME}://`)) {
      const afterScheme = url.slice(`${CUSTOM_SCHEME}://`.length);
      const [pathPart, queryPart] = afterScheme.split("#", 1)[0].split("?");
      path = "/" + pathPart.replace(/^\/+/, "");
      params = parseQueryString(queryPart || "");
    }
    // Handle https:// universal links
    else if (url.startsWith("https://") || url.startsWith("http://")) {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Only accept our domains
      if (
        host !== PRODUCTION_DOMAIN && host !== WWW_DOMAIN &&
        !(isDev && (host === "localhost" || host === "127.0.0.1" || host === "[::1]" ||
          host.endsWith(".exp.direct") || host.endsWith(".expo.dev")))
      ) {
        console.log("[LinkEngine] Rejected unknown domain:", host);
        return null;
      }

      if (parsed.username || parsed.password ||
          (!isDev && (parsed.protocol !== "https:" || (parsed.port && parsed.port !== "443")))) return null;
      path = parsed.pathname;
      params = Object.fromEntries(parsed.searchParams.entries());
    }
    // Handle exp:// dev URLs (Expo Go)
    else if (url.startsWith("exp://")) {
      if (!isDev) return null;
      const parsed = new URL(url);
      // exp:// URLs have the path after the port, e.g. exp://192.168.1.1:8081/--/u/mike
      const pathMatch = parsed.pathname.match(/\/--\/(.*)/);
      if (pathMatch) {
        path = "/" + pathMatch[1];
      } else {
        path = parsed.pathname;
      }
      params = Object.fromEntries(parsed.searchParams.entries());
    } else {
      // Treat only ordinary relative paths as paths, never foreign schemes.
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
      path = (url.startsWith("/") ? url : "/" + url).split("#", 1)[0];
      const qIdx = path.indexOf("?");
      if (qIdx !== -1) {
        params = parseQueryString(path.slice(qIdx + 1));
        path = path.slice(0, qIdx);
      }
    }

    // Normalize path
    path = normalizePath(path);
    if (path.includes("//")) return null;
    if (!path || path === "/") {
      return null; // Root path, no deep link needed
    }

    // Handoff IDs are routing identifiers, never credentials. Validate query
    // values before substituting them into the native route.
    if (path === "/live-photo-handoff") {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuid.test(params.handoff || "") || !uuid.test(params.draft || "")) return null;
      params = { handoff: params.handoff, draft: params.draft };
    }

    // Decode exactly one room segment, then validate the opaque ID. Query
    // fields never select the room or carry media/access/verification choices.
    const roomPath = path.match(/^(\/(?:(?:feed\/)?sneaky-lynk\/room|(?:feed\/)?sneaky-lynk|sl|sneaky))\/([^/]+)$/i);
    const isPaymentReturn = /^\/sneaky\/(success|cancel)$/i.test(path);
    if (roomPath && !isPaymentReturn) {
      const id = normalizeLynkRoomId(decodeURIComponent(roomPath[2]));
      if (!id || id === "my-room" || id.startsWith("space-")) return null;
      path = `${roomPath[1]}/${id}`;
      params = {};
    }

    // Match against route registry
    const match = matchRoute(path);
    const requiresAuth = match ? match.entry.auth === "auth-required" : true;
    let routerPath = match
      ? buildRouterPath(match.entry.routerPath, { ...params, ...match.params })
      : path;

    if (match && ["/(auth)/verify-email", "/(auth)/reset-password"].includes(match.entry.routerPath)) {
      // Recovery/verification support both token links and a session callback.
      // Keep only screen inputs; never forward a user-controlled redirect.
      params = Object.fromEntries(Object.entries(params).filter(([key, value]) =>
        (key === "token" || key === "error") && !/[\u0000-\u001f\u007f]/.test(value)));
      const query = new URLSearchParams(params).toString();
      if (query) routerPath += `?${query}`;
    }

    // Merge route params with query params
    const allParams = match ? { ...params, ...match.params } : params;

    return {
      originalUrl: url,
      path,
      params: allParams,
      routerPath,
      requiresAuth,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error("[LinkEngine] Failed to parse incoming URL");
    return null;
  }
}

// ── 2) routePolicy ──────────────────────────────────────────────────

export interface RoutePolicy {
  isPublic: boolean;
  requiresAuth: boolean;
  matchedEntry: RouteEntry | null;
}

export function routePolicy(path: string): RoutePolicy {
  const match = matchRoute(path);
  if (!match) {
    return { isPublic: false, requiresAuth: true, matchedEntry: null };
  }
  return {
    isPublic: match.entry.auth === "public",
    requiresAuth: match.entry.auth === "auth-required",
    matchedEntry: match.entry,
  };
}

// ── 3) resolveNavigationTarget ──────────────────────────────────────

export interface NavigationTarget {
  path: string;
  params?: Record<string, string>;
  valid: boolean;
  reason?: string;
}

export function resolveGuestPublicTarget(
  parsed: ParsedDeepLink,
): NavigationTarget | null {
  const match = matchRoute(parsed.path);
  if (!match) return null;

  switch (match.entry.urlPattern) {
    case "/u/:username":
    case "/profile/:username":
      return {
        path: `/(public)/profile/${match.params.username}`,
        params: { ...parsed.params, ...match.params },
        valid: true,
      };
    case "/e/:id":
    case "/events/:id":
      // Public event detail exists at app/(public)/events/[id].tsx —
      // allows a guest to see the event + buy a ticket without
      // signing up. Post-session addition.
      return {
        path: `/(public)/events/${match.params.id}`,
        params: { ...parsed.params, ...match.params },
        valid: true,
      };
    case "/tickets/guest/:token":
      // Guest magic-link from the ticket confirmation email.
      return {
        path: `/(public)/tickets/guest/${match.params.token}`,
        params: { ...parsed.params, ...match.params },
        valid: true,
      };
    case "/home":
      return {
        path: "/(public)/(tabs)",
        params: parsed.params,
        valid: true,
      };
    case "/events":
      return {
        path: "/(public)/(tabs)/events",
        params: parsed.params,
        valid: true,
      };
    case "/search":
      return {
        path: "/(public)/search",
        params: parsed.params,
        valid: true,
      };
    case "/activity":
      return {
        path: "/(public)/(tabs)/activity",
        params: parsed.params,
        valid: true,
      };
    case "/create":
      return {
        path: "/(public)/(tabs)/create",
        params: parsed.params,
        valid: true,
      };
    default:
      return null;
  }
}

export function resolveNavigationTarget(
  parsed: ParsedDeepLink,
): NavigationTarget {
  const match = matchRoute(parsed.path);

  if (!match) {
    // Unknown route — navigate to home as fallback
    return {
      path: "/(protected)/(tabs)",
      valid: false,
      reason: `No route match for: ${parsed.path}`,
    };
  }

  return {
    path: buildRouterPath(match.entry.routerPath, { ...parsed.params, ...match.params }).split("?")[0],
    params: { ...parsed.params, ...match.params },
    valid: true,
  };
}

/** Whether the parsed target is a server-backed Lynk prejoin screen. */
export function isLynkRoomLink(parsed: ParsedDeepLink): boolean {
  const prefix = "/(protected)/sneaky-lynk/room/";
  return parsed.routerPath.startsWith(prefix) && normalizeLynkRoomId(parsed.routerPath.slice(prefix.length)) !== null;
}

export function deepLinkAccountKey(): string | null {
  const { user, isAuthenticated, authStatus, _hasHydrated } = useAuthStore.getState();
  return _hasHydrated && isAuthenticated && authStatus === "authenticated" ? user?.authId || user?.id || null : null;
}

let trackingAccounts = false;
/** Covers A → B → A transitions even when React batches away the middle render. */
export function trackDeepLinkAccount(): void {
  if (trackingAccounts) return;
  trackingAccounts = true;
  useAuthStore.subscribe((next, previous) => {
    const oldKey = previous.user?.authId || previous.user?.id;
    const newKey = next.user?.authId || next.user?.id;
    const store = useDeepLinkStore.getState();
    if (oldKey && (oldKey !== newKey || !next.isAuthenticated)) {
      if (store.pendingAccountKey) store.setPendingLink(null);
      // A new account may intentionally reopen the same URL within 3 seconds.
      useDeepLinkStore.setState({ lastHandledUrl: null, lastHandledAt: 0 });
      lastNavigationKey = "";
      lastNavigationTime = 0;
    }
    if (next._hasHydrated && next.isAuthenticated && next.authStatus === "authenticated" && newKey) {
      store.bindPendingAccount(newKey);
    }
  });
}

// ── 4) handleDeepLink (main entry point) ─────────────────────────────

/**
 * Main entry point for processing an incoming deep link URL.
 * Handles auth gating, replay protection, and navigation.
 */
export function handleDeepLink(url: string): void {
  trackDeepLinkAccount();
  const store = useDeepLinkStore.getState();

  // Replay protection
  if (store.isReplay(url)) {
    console.log("[LinkEngine] Replay detected, skipping");
    return;
  }

  const parsed = parseIncomingUrl(url);
  if (!parsed) {
    console.log("[LinkEngine] Could not parse incoming URL");
    return;
  }

  console.log("[LinkEngine] Handling deep link:", parsed.path);

  // Mark as handled
  store.markHandled(url);

  // Check auth state
  const isAuthenticated = !!deepLinkAccountKey();

  if (!isAuthenticated) {
    const guestTarget = resolveGuestPublicTarget(parsed);
    if (guestTarget) {
      store.setPendingLink(null);
      navigateToTarget(guestTarget);
      return;
    }
  }

  if (parsed.requiresAuth && !isAuthenticated) {
    // Save as pending link — will be replayed after login
    console.log("[LinkEngine] Auth required, saving as pending link");
    store.setPendingLink(parsed);
    router.replace("/(auth)/login" as any);
    return;
  }

  // A newer content destination supersedes a queued login replay. Public
  // authentication callbacks do not erase the room the member came to open.
  if (parsed.requiresAuth) {
    store.setPendingLink(isLynkRoomLink(parsed) ? parsed : null, deepLinkAccountKey());
  }
  navigateOnce(parsed);
}

// ── 5) navigateOnce ──────────────────────────────────────────────────

let lastNavigationKey = "";
let lastNavigationTime = 0;
const NAV_DEBOUNCE_MS = 500;

/**
 * Navigate to a deep link target exactly once.
 * Prevents double navigation and duplicate transitions.
 */
export function navigateOnce(parsed: ParsedDeepLink): void {
  const target = resolveNavigationTarget(parsed);
  navigateToTarget(target);
}

function navigateToTarget(target: NavigationTarget): void {
  const now = Date.now();
  const key = JSON.stringify([target.path, target.params || {}]);
  // Distinct recovery/verification tokens are distinct intents, even on the
  // same auth screen. Never suppress a newer token as a duplicate pathname.
  if (
    key === lastNavigationKey &&
    now - lastNavigationTime < NAV_DEBOUNCE_MS
  ) {
    console.log("[LinkEngine] Duplicate navigation prevented:", target.path);
    return;
  }

  lastNavigationKey = key;
  lastNavigationTime = now;

  if (!target.valid) {
    console.warn("[LinkEngine] Invalid route, navigating to fallback:", target.reason);
  }

  console.log("[LinkEngine] Navigating to:", target.path);

  try {
    // Use replace for auth routes, push for everything else
    const isAuthRoute = target.path.startsWith("/(auth)");
    if (isAuthRoute || target.path === "/(public)/(tabs)") {
      router.replace(target.params && Object.keys(target.params).length
        ? { pathname: target.path as any, params: target.params } as any
        : target.path as any);
    } else if (target.params && Object.keys(target.params).length > 0) {
      router.push({ pathname: target.path as any, params: target.params } as any);
    } else {
      router.push(target.path as any);
    }
  } catch (err) {
    console.error("[LinkEngine] Navigation failed");
    // Fallback to home
    try {
      router.replace("/(protected)/(tabs)" as any);
    } catch {
      // Silently fail — app will show whatever screen it's on
    }
  }
}

// ── 6) replayPendingLink ─────────────────────────────────────────────

/**
 * Called after successful login to replay any pending deep link.
 */
export function replayPendingLink(options: {
  delayMs?: number;
  canReplay?: (pending: ParsedDeepLink) => Promise<boolean>;
  currentPath?: string;
} = {}): () => void {
  trackDeepLinkAccount();
  const store = useDeepLinkStore.getState();
  const pending = store.pendingLink;
  const accountKey = deepLinkAccountKey();
  if (!pending || !accountKey) return () => {};
  if (store.pendingAccountKey && store.pendingAccountKey !== accountKey) {
    store.setPendingLink(null);
    return () => {};
  }
  store.bindPendingAccount(accountKey);
  const pathname = pending.routerPath.replace(/^\/\(protected\)/, "");
  if (options.currentPath === pathname && !store.pendingOnboarding) {
    // Arrival completes navigation immediately. No slow background progress
    // read may later pull someone back after they leave the room. Mandatory
    // setup redirects explicitly preserve their own continuation below.
    store.consumePendingLink();
    return () => {};
  }
  let cancelled = false;
  const isCurrent = () => !cancelled && deepLinkAccountKey() === accountKey &&
    useDeepLinkStore.getState().pendingLink === pending &&
    useDeepLinkStore.getState().pendingAccountKey === accountKey;
  // Keep the pending link until dispatch. Newer links, logout, account changes,
  // effect cleanup and mandatory onboarding can all cancel this delayed work.
  const timer = setTimeout(async () => {
    if (!isCurrent()) return;
    try {
      if (options.canReplay && !(await options.canReplay(pending))) return;
      if (!isCurrent()) return;
      useDeepLinkStore.getState().consumePendingLink();
      if (options.currentPath !== pathname) navigateOnce(pending);
    } catch {
      // An unknown progress read is not completed onboarding. Keep the room
      // intent for the next route/auth transition rather than losing it.
    }
  }, options.delayMs ?? 150);
  return () => { cancelled = true; clearTimeout(timer); };
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  let p = path.trim();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function parseQueryString(qs: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(qs).entries());
}
