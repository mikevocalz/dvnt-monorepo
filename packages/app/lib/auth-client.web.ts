/**
 * Better Auth Client for Web (Vite)
 * Uses cookies + credentials:include — no expo-secure-store, no @better-auth/expo
 */

import { QueryClient } from "@tanstack/react-query";
import { logAuth, type SignOutReason } from "./auth/auth-logger";
// Better Auth client now lives in @dvnt/auth (PROMPT 0 §3); web plumbing stays here.
import {
  authClient,
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
} from "@dvnt/auth";

export { authClient, signIn, signUp, signOut, useSession, getSession };

type BetterAuthRecoveryClient = typeof authClient & {
  // Newer Better Auth (the client bundles 1.6.x) renamed forget-password ->
  // request-password-reset. The auth edge function only exposes
  // /request-password-reset, so the deprecated forgetPassword alias 404s.
  requestPasswordReset?: (args: { email: string; redirectTo: string }) => Promise<{ error?: { message?: string } | null }>;
  forgetPassword?: (args: { email: string; redirectTo: string }) => Promise<{ error?: { message?: string } | null }>;
  resetPassword?: (args: { newPassword: string; token?: string }) => Promise<{ error?: { message?: string } | null }>;
  sendVerificationEmail?: (args: { email: string }) => Promise<{ error?: { message?: string } | null }>;
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
  return recoveryClient.sendVerificationEmail({ email });
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

let _sessionFlight: Promise<{ data: any; error: any }> | null = null;
let _cachedToken: string | null = null;
let _cachedTokenExpiry = 0;

async function getSessionSingleFlight(): Promise<{ data: any; error: any }> {
  if (_sessionFlight) return _sessionFlight;
  _sessionFlight = authClient.getSession()
    .then((result: any) => result)
    .catch((err: any) => ({ data: null, error: String(err) }))
    .finally(() => { _sessionFlight = null; });
  return _sessionFlight;
}

export async function getAuthToken(): Promise<string | null> {
  if (_cachedToken && Date.now() < _cachedTokenExpiry) return _cachedToken;
  try {
    const { data: session, error } = await getSessionSingleFlight();
    if (error) {
      logAuth("AUTH_REFRESH_FAIL", { error: String(error) });
      return null;
    }
    const token = session?.session?.token || null;
    if (token) { _cachedToken = token; _cachedTokenExpiry = Date.now() + 4 * 60 * 1000; }
    return token;
  } catch (error) {
    logAuth("AUTH_REFRESH_FAIL", { error: String(error) });
    return null;
  }
}

export function invalidateTokenCache() { _cachedToken = null; _cachedTokenExpiry = 0; }

export interface AppUser {
  id: string; authId?: string; email: string; username: string; name: string;
  avatar?: string; bio?: string; website?: string; links?: string[]; location?: string;
  hashtags?: string[]; isVerified: boolean; postsCount: number; followersCount: number;
  followingCount: number; gender?: string; pronouns?: string;
}
