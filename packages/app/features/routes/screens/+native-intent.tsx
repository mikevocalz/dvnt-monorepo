/**
 * Native Intent Handler
 * Expo Router calls this for every incoming URL (universal links, scheme links, cold start).
 * We parse through the Link Engine and return the correct Expo Router path.
 */

import { parseIncomingUrl, resolveNavigationTarget, resolveGuestPublicTarget, isLynkRoomLink, deepLinkAccountKey, trackDeepLinkAccount } from "@dvnt/app/lib/deep-linking/link-engine";
import { useDeepLinkStore } from "@dvnt/app/lib/stores/deep-link-store";

const SHARE_INTENT_MARKERS = /^dvnt:\/\/(?:dataUrl=|dvntShareKey(?:[/?#]|$))/i;
const DEV_CLIENT_BOOTSTRAP_MARKERS =
  /^(?:(?:exp\+dvnt|dvnt):\/\/|\/?)expo-development-client(?:[/?#]|$)/i;

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}) {
  console.log("[NativeIntent] Incoming link; initial:", initial);

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

  if (!resolveNavigationTarget(parsed).valid) return "/";
  trackDeepLinkAccount();

  // Expo expects a destination, not a skip sentinel. Returning "/" for a
  // duplicate room event would send a member who just opened it to the feed.
  const store = useDeepLinkStore.getState();
  if (store.isReplay(path)) {
    console.log("[NativeIntent] Replay detected, skipping");
    if (!deepLinkAccountKey()) {
      const guestTarget = resolveGuestPublicTarget(parsed);
      if (guestTarget) return guestTarget.path;
      if (parsed.requiresAuth) return "/(auth)/login";
    }
    return parsed.routerPath;
  }
  store.markHandled(path);

  // Auth gating: if route requires auth and user isn't authenticated, save as pending
  const isAuthenticated = !!deepLinkAccountKey();
  if (!isAuthenticated) {
    const guestTarget = resolveGuestPublicTarget(parsed);
    if (guestTarget) {
      // An intentional newer public destination replaces the old room intent.
      // Authentication routes are not public content and retain that intent.
      store.setPendingLink(null);
      return guestTarget.path;
    }
  }

  if (parsed.requiresAuth && !isAuthenticated) {
    console.log(
      "[NativeIntent] Auth required, saving pending link:",
      parsed.path,
    );
    store.setPendingLink(parsed);
    return "/(auth)/login";
  }

  if (parsed.requiresAuth) {
    store.setPendingLink(isLynkRoomLink(parsed) ? parsed : null, deepLinkAccountKey());
  }
  console.log("[NativeIntent] Routing to:", parsed.routerPath.split("?")[0]);
  return parsed.routerPath;
}
