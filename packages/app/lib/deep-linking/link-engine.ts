/**
 * Link Engine
 * Central deep link processing: parse → policy → resolve → navigate.
 * Handles https://dvntapp.live/*, dvnt://*, and Expo dev URLs.
 */

import { router } from "expo-router";
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
  /^exp\+dvnt:\/\/expo-development-client\b|^dvnt:\/\/expo-development-client\b|expo-development-client\/?\?url=/i;

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

    // Handle dvnt:// scheme
    if (url.startsWith(`${CUSTOM_SCHEME}://`)) {
      const afterScheme = url.slice(`${CUSTOM_SCHEME}://`.length);
      const [pathPart, queryPart] = afterScheme.split("?");
      path = "/" + pathPart.replace(/^\/+/, "");
      params = parseQueryString(queryPart || "");
    }
    // Handle https:// universal links
    else if (url.startsWith("https://") || url.startsWith("http://")) {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      // Only accept our domains
      if (
        host !== PRODUCTION_DOMAIN &&
        host !== WWW_DOMAIN &&
        !host.includes("localhost") &&
        !host.includes("expo")
      ) {
        console.log("[LinkEngine] Rejected unknown domain:", host);
        return null;
      }

      path = parsed.pathname;
      params = Object.fromEntries(parsed.searchParams.entries());
    }
    // Handle exp:// dev URLs (Expo Go)
    else if (url.startsWith("exp://")) {
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
      // Treat as bare path
      path = url.startsWith("/") ? url : "/" + url;
      const qIdx = path.indexOf("?");
      if (qIdx !== -1) {
        params = parseQueryString(path.slice(qIdx + 1));
        path = path.slice(0, qIdx);
      }
    }

    // Normalize path
    path = normalizePath(path);
    if (!path || path === "/") {
      return null; // Root path, no deep link needed
    }

    // Match against route registry
    const match = matchRoute(path);
    const requiresAuth = match ? match.entry.auth === "auth-required" : true;
    const routerPath = match
      ? buildRouterPath(match.entry.routerPath, { ...match.params, ...params })
      : path;

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
    console.error("[LinkEngine] Failed to parse URL:", url, err);
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

function resolveGuestPublicTarget(
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
    path: buildRouterPath(match.entry.routerPath, match.params),
    params: { ...parsed.params, ...match.params },
    valid: true,
  };
}

// ── 4) handleDeepLink (main entry point) ─────────────────────────────

/**
 * Main entry point for processing an incoming deep link URL.
 * Handles auth gating, replay protection, and navigation.
 */
export function handleDeepLink(url: string): void {
  const store = useDeepLinkStore.getState();

  // Replay protection
  if (store.isReplay(url)) {
    console.log("[LinkEngine] Replay detected, skipping:", url);
    return;
  }

  const parsed = parseIncomingUrl(url);
  if (!parsed) {
    console.log("[LinkEngine] Could not parse URL:", url);
    return;
  }

  console.log("[LinkEngine] Handling deep link:", parsed.path, parsed.params);

  // Mark as handled
  store.markHandled(url);

  // Check auth state
  const { isAuthenticated } = useAuthStore.getState();

  if (!isAuthenticated) {
    const guestTarget = resolveGuestPublicTarget(parsed);
    if (guestTarget) {
      navigateToTarget(guestTarget);
      return;
    }
  }

  if (parsed.requiresAuth && !isAuthenticated) {
    // Save as pending link — will be replayed after login
    console.log("[LinkEngine] Auth required, saving as pending link");
    store.setPendingLink(parsed);
    return;
  }

  // Navigate
  navigateOnce(parsed);
}

// ── 5) navigateOnce ──────────────────────────────────────────────────

let lastNavigationPath = "";
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
  // Prevent double navigation
  if (
    target.path === lastNavigationPath &&
    now - lastNavigationTime < NAV_DEBOUNCE_MS
  ) {
    console.log("[LinkEngine] Duplicate navigation prevented:", target.path);
    return;
  }

  lastNavigationPath = target.path;
  lastNavigationTime = now;

  if (!target.valid) {
    console.warn("[LinkEngine] Invalid route, navigating to fallback:", target.reason);
  }

  console.log("[LinkEngine] Navigating to:", target.path);

  try {
    // Use replace for auth routes, push for everything else
    const isAuthRoute = target.path.startsWith("/(auth)");
    if (isAuthRoute || target.path === "/(public)/(tabs)") {
      router.replace(target.path as any);
    } else if (target.params && Object.keys(target.params).length > 0) {
      router.push({ pathname: target.path as any, params: target.params } as any);
    } else {
      router.push(target.path as any);
    }
  } catch (err) {
    console.error("[LinkEngine] Navigation failed:", err);
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
export function replayPendingLink(): void {
  const pending = useDeepLinkStore.getState().consumePendingLink();
  if (!pending) return;

  console.log("[LinkEngine] Replaying pending link:", pending.path);

  // Small delay to let auth state propagate and navigation stack settle
  setTimeout(() => {
    navigateOnce(pending);
  }, 300);
}

// ── Helpers ──────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  let p = path.trim();
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (!p.startsWith("/")) p = "/" + p;
  return p;
}

function parseQueryString(qs: string): Record<string, string> {
  if (!qs) return {};
  const params: Record<string, string> = {};
  const pairs = qs.split("&");
  for (const pair of pairs) {
    const [key, value] = pair.split("=");
    if (key) {
      params[decodeURIComponent(key)] = decodeURIComponent(value || "");
    }
  }
  return params;
}
