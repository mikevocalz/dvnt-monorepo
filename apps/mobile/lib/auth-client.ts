/**
 * Better Auth Client for Expo
 *
 * Use this client in React components to handle authentication.
 * Provides hooks and methods for sign in, sign up, sign out, and session management.
 */

import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { usernameClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";
import * as SecureStore from "expo-secure-store";
import { QueryClient } from "@tanstack/react-query";
import { logAuth, type SignOutReason } from "@/lib/auth/auth-logger";

// Auth server URL — Better Auth hosted in Supabase Edge Function (CANONICAL)
// IMPORTANT: Better Auth client uses baseURL as origin-only and appends basePath.
// baseURL MUST be just the origin (no path), basePath routes through the Edge Function.
const AUTH_FULL_URL =
  process.env.EXPO_PUBLIC_AUTH_URL ||
  "https://npfjanxturvmjyevoyfo.supabase.co/functions/v1/auth";

// Extract origin from the full URL (e.g. "https://npfjanxturvmjyevoyfo.supabase.co")
const AUTH_ORIGIN = new URL(AUTH_FULL_URL).origin;
// Extract the path prefix (e.g. "/functions/v1/auth") and append Better Auth's route prefix
const AUTH_PATH_PREFIX = new URL(AUTH_FULL_URL).pathname.replace(/\/$/, "");
const AUTH_BASE_PATH = `${AUTH_PATH_PREFIX}/api/auth`;

console.log("[AuthClient] AUTH_ORIGIN:", AUTH_ORIGIN);
console.log("[AuthClient] AUTH_BASE_PATH:", AUTH_BASE_PATH);

// Create the Better Auth client
export const authClient = createAuthClient({
  baseURL: AUTH_ORIGIN,
  basePath: AUTH_BASE_PATH,
  plugins: [
    expoClient({
      scheme: "dvnt",
      storagePrefix: "dvnt",
      storage: SecureStore,
      cookiePrefix: "better-auth",
    }),
    usernameClient(),
    passkeyClient(),
  ],
});

// Export hooks and methods
export const { signIn, signUp, signOut, useSession, getSession } = authClient;

type BetterAuthRecoveryClient = typeof authClient & {
  forgetPassword?: (args: { email: string; redirectTo: string }) => Promise<{
    error?: { message?: string } | null;
  }>;
  resetPassword?: (args: { newPassword: string }) => Promise<{
    error?: { message?: string } | null;
  }>;
  sendVerificationEmail?: (args: { email: string }) => Promise<{
    error?: { message?: string } | null;
  }>;
};

const recoveryClient = authClient as BetterAuthRecoveryClient;

export const AUTH_RECOVERY_REDIRECT = "dvnt://auth/reset";

export async function requestPasswordReset(email: string) {
  if (!recoveryClient.forgetPassword) {
    throw new Error("Password reset is not available in this client build");
  }

  return recoveryClient.forgetPassword({
    email,
    redirectTo: AUTH_RECOVERY_REDIRECT,
  });
}

export async function submitPasswordReset(newPassword: string) {
  if (!recoveryClient.resetPassword) {
    throw new Error("Password reset is not available in this client build");
  }

  return recoveryClient.resetPassword({ newPassword });
}

export async function resendVerificationEmail(email: string) {
  if (!recoveryClient.sendVerificationEmail) {
    throw new Error(
      "Email verification resend is not available in this client build",
    );
  }

  return recoveryClient.sendVerificationEmail({ email });
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
    const { clearUserDataFromStorage } = require("@/lib/utils/storage");
    clearUserDataFromStorage();
    const { clearPersistedQueryCache } = require("@/lib/query-persistence");
    clearPersistedQueryCache();
    console.log("[Auth] ✓ MMKV storage + query persistence cleared");
  } catch (e) {
    console.error("[Auth] ✗ Failed to clear MMKV storage:", e);
  }

  // 3. Reset Zustand stores
  try {
    const { useProfileStore } = require("@/lib/stores/profile-store");
    const { useFeedPostUIStore } = require("@/lib/stores/feed-post-store");
    const {
      useFeedSlideStore,
      usePostStore,
    } = require("@/lib/stores/post-store");
    const { useBookmarkStore } = require("@/lib/stores/bookmark-store");
    const { useCartStore } = require("@/lib/stores/cart");

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

// ── Single-flight getSession mutex ──────────────────────────────────
// Prevents concurrent getSession() calls from racing (e.g. 5 API calls
// firing simultaneously each trigger their own refresh). Only ONE network
// call is in-flight; all callers share the same promise.
let _sessionFlight: Promise<{ data: any; error: any }> | null = null;
let _cachedToken: string | null = null;
let _cachedTokenExpiry = 0;

async function getSessionSingleFlight(): Promise<{ data: any; error: any }> {
  if (_sessionFlight) return _sessionFlight;
  _sessionFlight = authClient
    .getSession()
    .then((result: any) => result)
    .catch((err: any) => ({ data: null, error: String(err) }))
    .finally(() => {
      _sessionFlight = null;
    });
  return _sessionFlight;
}

// Get auth token for API requests — cached + single-flight + retry
export async function getAuthToken(): Promise<string | null> {
  // Fast path: return cached token if still valid (30s buffer before expiry)
  if (_cachedToken && Date.now() < _cachedTokenExpiry) {
    return _cachedToken;
  }

  try {
    const { data: session, error } = await getSessionSingleFlight();
    if (error) {
      logAuth("AUTH_REFRESH_FAIL", { error: String(error) });
      // Retry once after a brief pause — edge function cold starts
      await new Promise((r) => setTimeout(r, 500));
      const retry = await authClient.getSession();
      const retryToken = retry?.data?.session?.token || null;
      if (retryToken) {
        _cachedToken = retryToken;
        _cachedTokenExpiry = Date.now() + 4 * 60 * 1000; // cache 4min
        logAuth("AUTH_REFRESH_OK", { reason: "retry_succeeded" });
        return retryToken;
      }
      return null;
    }
    const token = session?.session?.token || null;
    if (token) {
      _cachedToken = token;
      _cachedTokenExpiry = Date.now() + 4 * 60 * 1000; // cache 4min
    }
    return token;
  } catch (error) {
    logAuth("AUTH_REFRESH_FAIL", { error: String(error) });
    return null;
  }
}

/** Invalidate cached token — call after signOut or identity change */
export function invalidateTokenCache() {
  _cachedToken = null;
  _cachedTokenExpiry = 0;
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
}
