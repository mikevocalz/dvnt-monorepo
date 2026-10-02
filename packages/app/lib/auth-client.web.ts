/**
 * Better Auth Client for Web (Vite)
 * Uses cookies + credentials:include — no expo-secure-store, no @better-auth/expo
 */

import { QueryClient } from "@tanstack/react-query";
import { logAuth, type SignOutReason } from "./auth/auth-logger";
// Better Auth client now lives in @dvnt/auth (PROMPT 0 §3); web plumbing stays here.
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
});

// Both named methods and authClient.signIn.* pass through the same boundary.
export const authClient = withAccountTokenInvalidation(baseAuthClient, tokenCache);
export const { signIn, signUp, signOut, useSession, getSession } = authClient;

type BetterAuthRecoveryClient = typeof authClient & {
  // Newer Better Auth (the client bundles 1.6.x) renamed forget-password ->
  // request-password-reset. The auth edge function only exposes
  // /request-password-reset, so the deprecated forgetPassword alias 404s.
  requestPasswordReset?: (args: { email: string; redirectTo: string }) => Promise<{ error?: { message?: string } | null }>;
  forgetPassword?: (args: { email: string; redirectTo: string }) => Promise<{ error?: { message?: string } | null }>;
  resetPassword?: (args: { newPassword: string; token?: string }) => Promise<{ error?: { message?: string } | null }>;
  sendVerificationEmail?: (args: { email: string; callbackURL?: string }) => Promise<{ error?: { message?: string } | null }>;
  verifyEmail?: (args: { query: { token: string } }) => Promise<{ data?: { status?: boolean } | null; error?: { message?: string } | null }>;
};

const recoveryClient = authClient as BetterAuthRecoveryClient;

// SSR-safe: `window` is undefined during Next's server render.
export const AUTH_RECOVERY_REDIRECT =
  typeof window !== "undefined"
    ? `${window.location.origin}/auth/reset-password`
    : "/auth/reset-password";

export async function requestPasswordReset(email: string) {
  // Prefer the current method (/request-password-reset, which the edge
  // function serves); fall back to the legacy alias for older servers.
  const fn = recoveryClient.requestPasswordReset ?? recoveryClient.forgetPassword;
  if (!fn) throw new Error("Password reset not available");
  return fn({ email, redirectTo: AUTH_RECOVERY_REDIRECT });
}

export async function submitPasswordReset(newPassword: string, token?: string) {
  if (!recoveryClient.resetPassword) throw new Error("Password reset not available");
  // Web reset is TOKEN-BASED: the email link carries ?token= and we complete
  // the reset with it directly (no session cookie, which Better Auth sets on the
  // Supabase domain — not the app domain).
  return recoveryClient.resetPassword(
    token ? { newPassword, token } : { newPassword },
  );
}

/** Token-based email verification (web) — completes with the ?token= from the
 *  email link instead of relying on a cross-domain session cookie. */
export async function submitEmailVerification(token: string) {
  if (!recoveryClient.verifyEmail) throw new Error("Email verification not available");
  return recoveryClient.verifyEmail({ query: { token } });
}

export async function resendVerificationEmail(email: string) {
  if (!recoveryClient.sendVerificationEmail) throw new Error("Email verification not available");
  // Without a callbackURL the emitted link 302s to "/" on the Supabase
  // origin after verifying — a dead page. Point it at this app's own
  // verify screen so the click lands back on a working page.
  const callbackURL =
    typeof window !== "undefined"
      ? `${window.location.origin}/auth/verify-email`
      : "https://dvntapp.live/auth/verify-email";
  return recoveryClient.sendVerificationEmail({ email, callbackURL });
}

let globalQueryClient: QueryClient | null = null;
export function setQueryClient(client: QueryClient) { globalQueryClient = client; }
export function getQueryClient(): QueryClient | null { return globalQueryClient; }

export function clearAllCachedData() {
  if (globalQueryClient) {
    globalQueryClient.cancelQueries();
    globalQueryClient.removeQueries();
    globalQueryClient.clear();
  }
  try { localStorage.removeItem('dvnt-query-cache'); } catch {}
}

export async function handleSignOut(reason: SignOutReason = "USER_REQUESTED") {
  logAuth("AUTH_SIGNOUT_TRIGGERED", { reason });
  invalidateTokenCache();
  try { await signOut(); } catch (e) { console.warn("[Auth] Server sign-out failed:", e); }
  clearAllCachedData();
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

export interface AppUser {
  id: string; authId?: string; email: string; username: string; name: string;
  avatar?: string; bio?: string; website?: string; links?: string[]; location?: string;
  hashtags?: string[]; isVerified: boolean; postsCount: number; followersCount: number;
  followingCount: number; gender?: string; pronouns?: string;
  sexuality?: string[]; eventAudience?: string;
}
