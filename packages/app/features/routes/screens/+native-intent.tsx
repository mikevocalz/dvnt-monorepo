/**
 * Native Intent Handler
 * Expo Router calls this for every incoming URL (universal links, scheme links, cold start).
 * We parse through the Link Engine and return the correct Expo Router path.
 */

import { parseIncomingUrl } from "@dvnt/app/lib/deep-linking/link-engine";
import { useDeepLinkStore } from "@dvnt/app/lib/stores/deep-link-store";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

const SHARE_INTENT_MARKERS = /dataUrl=|dvntShareKey/i;
const DEV_CLIENT_BOOTSTRAP_MARKERS =
  /^exp\+dvnt:\/\/expo-development-client\b|^dvnt:\/\/expo-development-client\b|expo-development-client\/?\?url=/i;

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  console.log("[NativeIntent] Incoming:", path, "initial:", initial);

  // Skip empty or root paths
  if (!path || path === "/" || path === "") return "/";

  // Expo dev-client launches can arrive through the app scheme during local
  // development. They are bootstrap URLs, not in-app routes.
  if (DEV_CLIENT_BOOTSTRAP_MARKERS.test(path)) {
    console.log("[NativeIntent] Ignoring Expo dev-client bootstrap URL");
    return "/";
  }

  // Share intents from iOS Share Extension open app with dvnt://dataUrl=dvntShareKey#text
  // (or #media, #weburl, #file). These are not routes — open home; ShareIntentHandler
  // will process the shared data from native storage.
  if (SHARE_INTENT_MARKERS.test(path)) {
    console.log("[NativeIntent] Share intent detected, opening home");
    useDeepLinkStore.getState().setOpenedFromShareIntent(true);
    return "/";
  }

  const parsed = parseIncomingUrl(path);
  if (!parsed) {
    console.log("[NativeIntent] Could not parse, falling back to /");
    return "/";
  }

  // Replay protection
  const store = useDeepLinkStore.getState();
  if (store.isReplay(path)) {
    console.log("[NativeIntent] Replay detected, skipping");
    return "/";
  }
  store.markHandled(path);

  // Auth gating: if route requires auth and user isn't authenticated, save as pending
  const { isAuthenticated } = useAuthStore.getState();
  if (!isAuthenticated) {
    const normalizedPath = parsed.path.toLowerCase();
    const userProfileMatch =
      normalizedPath.match(/^\/u\/([^/?#]+)/) ||
      normalizedPath.match(/^\/profile\/([^/?#]+)/);

    if (userProfileMatch?.[1]) {
      const username = decodeURIComponent(userProfileMatch[1]);
      return `/(public)/profile/${username}`;
    }

    if (normalizedPath === "/search") {
      return "/(public)/search";
    }

    if (normalizedPath === "/activity") {
      return "/(public)/(tabs)/activity";
    }

    if (normalizedPath === "/create") {
      return "/(public)/(tabs)/create";
    }
  }

  if (parsed.requiresAuth && !isAuthenticated) {
    console.log(
      "[NativeIntent] Auth required, saving pending link:",
      parsed.path,
    );
    store.setPendingLink(parsed);
    return "/"; // Let the auth guard show login
  }

  console.log("[NativeIntent] Routing to:", parsed.routerPath);
  return parsed.routerPath;
}
