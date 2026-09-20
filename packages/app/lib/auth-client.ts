/**
 * Better Auth Client for Expo
 *
 * Use this client in React components to handle authentication.
 * Provides hooks and methods for sign in, sign up, sign out, and session management.
 */

import * as SecureStore from "expo-secure-store";
import { QueryClient } from "@tanstack/react-query";
import { logAuth, type SignOutReason } from "@dvnt/app/lib/auth/auth-logger";
// The Better Auth client now lives in @dvnt/auth (PROMPT 0 §3). The app-level
// auth plumbing below (recovery, sign-out, token cache) stays here and imports it.
import { authClient as baseAuthClient } from "@dvnt/auth";
import { useAuthStore } from "./stores/auth-store";
import {
  createAccountTokenCache,
  withAccountTokenInvalidation,
} from "./auth/account-token-cache";

// Subscribe lazily: auth-store imports this module during its own creation.
let observingTokenOwner = false;
const tokenCache = createAccountTokenCache({
  getIdentity: () => {
    if (!observingTokenOwner) {
      observingTokenOwner = true;
      useAuthStore.subscribe(() => tokenCache.observeIdentity());
    }
    return useAuthStore.getState().user;
  },
  getSession: () => baseAuthClient.getSession(),
  onError: (error) => logAuth("AUTH_REFRESH_FAIL", { error: String(error) }),
  retryDelayMs: 500,
});

// Both named methods and authClient.signIn.* pass through the same boundary.
export const authClient = withAccountTokenInvalidation(baseAuthClient, tokenCache);
export const { signIn, signUp, signOut, useSession, getSession } = authClient;

type BetterAuthRecoveryClient = typeof authClient & {
  // Newer Better Auth renamed forget-password -> request-password-reset; the
  // auth edge function only exposes /request-password-reset (the legacy alias
  // 404s).
  requestPasswordReset?: (args: { email: string; redirectTo: string }) => Promise<{
    error?: { message?: string } | null;
  }>;
  forgetPassword?: (args: { email: string; redirectTo: string }) => Promise<{
    error?: { message?: string } | null;
  }>;
  resetPassword?: (args: {
    newPassword: string;
    token?: string;
  }) => Promise<{
    error?: { message?: string } | null;
  }>;
  sendVerificationEmail?: (args: {
    email: string;
    callbackURL?: string;
  }) => Promise<{
    error?: { message?: string } | null;
  }>;
  verifyEmail?: (args: { query: { token: string } }) => Promise<{
    data?: { status?: boolean; user?: { emailVerified?: boolean } } | null;
    error?: { message?: string } | null;
  }>;
};

const recoveryClient = authClient as BetterAuthRecoveryClient;

export const AUTH_RECOVERY_REDIRECT = "dvnt://auth/reset";

/**
 * Where the reset email link should send the user back to. On WEB this MUST be
 * the web origin's reset page so the link is first-party + token-based — the
 * old hardcoded `dvnt://` deep link made web reset impossible (the browser
 * can't open dvnt://, and the recovery cookie landed on the wrong domain →
 * "This link is no longer valid"). Native keeps the deep link.
 */
function recoveryRedirect(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/auth/reset-password`;
  }
  return AUTH_RECOVERY_REDIRECT;
}

export async function requestPasswordReset(email: string) {
  const fn = recoveryClient.requestPasswordReset ?? recoveryClient.forgetPassword;
  if (!fn) {
    throw new Error("Password reset is not available in this client build");
  }

  return fn({
    email,
    redirectTo: recoveryRedirect(),
  });
}

/**
 * Submit a new password. On web the recovery token comes from the email link's
 * `?token=` query (token-based reset — no session/cookie needed). Native still
 * uses the session-based flow (no token), so token is optional.
 */
export async function submitPasswordReset(newPassword: string, token?: string) {
  if (!recoveryClient.resetPassword) {
    throw new Error("Password reset is not available in this client build");
  }

  return recoveryClient.resetPassword(
    token ? { newPassword, token } : { newPassword },
  );
}

/**
 * Token-based email verification (web). The email link carries `?token=`; we
 * complete verification with that token directly instead of relying on a
 * cross-domain session cookie (same web issue the reset flow had).
 */
export async function submitEmailVerification(token: string) {
  if (!recoveryClient.verifyEmail) {
    throw new Error("Email verification is not available in this client build");
  }
  return recoveryClient.verifyEmail({ query: { token } });
}

/**
 * Where the verify-email link should send the user back to. Web gets its own
 * origin's verify page (first-party token link); native gets the dvnt://
 * deep link the route registry maps to /(auth)/verify-email. Without a
 * callbackURL the server emits "/" and the post-verify redirect dies on the
 * Supabase origin's 404 root — the email verifies but looks broken.
 */
function verificationRedirect(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/auth/verify-email`;
  }
  return "dvnt://auth/verify";
}

export async function resendVerificationEmail(email: string) {
  if (!recoveryClient.sendVerificationEmail) {
    throw new Error(
      "Email verification resend is not available in this client build",
    );
  }

  return recoveryClient.sendVerificationEmail({
    email,
    callbackURL: verificationRedirect(),
  });
}

// Reference to the global query client (set by the app)
let globalQueryClient: QueryClient | null = null;

export function setQueryClient(client: QueryClient) {
  globalQueryClient = client;
}

/**
 * Access the app-wide QueryClient outside a React tree. Safe for use from
 * Zustand stores / API layer for optimistic cache updates. Returns null
 * until `setQueryClient` has been called during app boot.
 */
export function getQueryClient(): QueryClient | null {
  return globalQueryClient;
}

// Clear all cached data when switching users
export function clearAllCachedData() {
  console.log("[Auth] === CLEARING ALL USER DATA ===");

  // 1. Clear React Query cache FIRST
  if (globalQueryClient) {
    globalQueryClient.cancelQueries();
    globalQueryClient.removeQueries();
    globalQueryClient.clear();
    globalQueryClient.resetQueries();
    console.log("[Auth] ✓ React Query cache cleared");
  }

  // 2. Clear persisted storage (MMKV) — includes TanStack Query persistence
  try {
    const { clearUserDataFromStorage } = require("@dvnt/app/lib/utils/storage");
    clearUserDataFromStorage();
    const { clearPersistedQueryCache } = require("@dvnt/app/lib/query-persistence");
    clearPersistedQueryCache();
    console.log("[Auth] ✓ MMKV storage + query persistence cleared");
  } catch (e) {
    console.error("[Auth] ✗ Failed to clear MMKV storage:", e);
  }

  // 3. Reset Zustand stores
  try {
    const { useProfileStore } = require("@dvnt/app/lib/stores/profile-store");
    const { useFeedPostUIStore } = require("@dvnt/app/lib/stores/feed-post-store");
    const {
      useFeedSlideStore,
      usePostStore,
    } = require("@dvnt/app/lib/stores/post-store");
    const { useBookmarkStore } = require("@dvnt/app/lib/stores/bookmark-store");
    const { useCartStore } = require("@dvnt/app/lib/stores/cart");

    useProfileStore.setState({
      activeTab: "posts",
      following: {},
      followers: {},
      editName: "",
      editBio: "",
      editWebsite: "",
      editLocation: "",
      editHashtags: [],
    });

    useFeedPostUIStore.setState({
      pressedPosts: {},
      likeAnimatingPosts: {},
      videoStates: {},
      previewMedia: null,
      showPreviewModal: false,
      activePostId: null,
      isMuted: true,
    });

    useFeedSlideStore.setState({ currentSlides: {} });
    usePostStore.setState({
      likedPosts: [],
      postLikeCounts: {},
      postCommentCounts: {},
      likedComments: [],
      commentLikeCounts: {},
    });
    useBookmarkStore.setState({ bookmarkedPosts: [] });
    useCartStore.getState().reset();

    console.log("[Auth] === ALL USER DATA CLEARED ===");
  } catch (error) {
    console.error("[Auth] Error resetting stores:", error);
  }
}

// Sign out and clear all data
export async function handleSignOut(reason: SignOutReason = "USER_REQUESTED") {
  logAuth("AUTH_SIGNOUT_TRIGGERED", { reason });

  // Invalidate cached token immediately
  invalidateTokenCache();

  // 1. Try server-side sign out FIRST (while token is still available)
  try {
    await signOut();
    console.log("[Auth] Server sign-out succeeded");
  } catch (error) {
    // Don't block local cleanup if server call fails
    console.warn(
      "[Auth] Server sign-out failed (continuing local cleanup):",
      error,
    );
  }

  // 1b. Drop the Supabase JWT bridge cache so the next signed-in user
  // doesn't inherit this user's `sub` claim on supabase-js calls.
  // Best-effort — never blocks sign-out.
  try {
    const { clearSupabaseJwt } = await import("./auth/supabase-jwt");
    await clearSupabaseJwt();
  } catch {
    // ignore — bridge is additive, sign-out continues either way
  }

  // 2. Clear all cached data (React Query, MMKV, Zustand stores)
  clearAllCachedData();

  // 3. Explicitly clear Better Auth session from SecureStore
  // The expo client stores cookies at `${storagePrefix}_cookie` and
  // cached session at `${storagePrefix}_session_data`.
  // With storagePrefix="dvnt", the actual keys are:
  //   "dvnt_cookie"        — session cookie JSON
  //   "dvnt_session_data"  — cached session data
  try {
    const keysToDelete = [
      "dvnt_cookie",
      "dvnt_session_data",
      // Legacy keys (in case format changes between versions)
      "better-auth_cookie",
      "better-auth_session_data",
    ];
    for (const key of keysToDelete) {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // Key may not exist, ignore
      }
    }
    console.log("[Auth] SecureStore session tokens cleared");
  } catch (error) {
    console.warn("[Auth] Failed to clear SecureStore:", error);
  }
}

// Account-scoped single-flight + expiry cache. Invalidated promises cannot
// return a token, refill the cache, or clear a newer account's in-flight fetch.
export function getAuthToken(): Promise<string | null> {
  return tokenCache.getToken();
}

export function invalidateTokenCache() {
  tokenCache.invalidate();
}

/** Reconcile a completed external sign-in before syncing its app profile. */
export function resumeAuthSession(): Promise<boolean> {
  return tokenCache.resumeSession();
}

// App user type for compatibility
export interface AppUser {
  id: string;
  authId?: string;
  email: string;
  username: string;
  name: string;
  avatar?: string;
  bio?: string;
  website?: string;
  links?: string[];
  location?: string;
  hashtags?: string[];
  isVerified: boolean;
  postsCount: number;
  followersCount: number;
  followingCount: number;
  gender?: string;
  pronouns?: string;
  /** "I am…" identity tags from onboarding (private filter data). */
  sexuality?: string[];
  /** "Looking for events w/…" audience preference from onboarding. */
  eventAudience?: string;
}
