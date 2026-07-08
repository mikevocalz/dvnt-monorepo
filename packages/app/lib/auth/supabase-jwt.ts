/**
 * Better Auth → Supabase JWT bridge (client side).
 *
 * SECONDARY AUTH LAYER. This module exists so PostgREST can see the
 * client as the `authenticated` role with the correct `sub` claim,
 * which makes the host-id-checking RLS policies on tables like
 * `tickets`, `ticket_types`, `events`, etc. actually fire for the
 * right user. Without this layer the client uses anon-only auth and
 * the permissive `_anon` / `_authenticated` bypass policies are
 * required for write paths to work.
 *
 * SAFETY MODEL — additive only:
 *   - Better Auth remains the source of truth for sign-in / sign-up /
 *     session lifecycle. This module never modifies Better Auth state.
 *   - Minting is best-effort. If the mint edge fn is missing the
 *     SUPABASE_JWT_SECRET, returns 503, or any other error, this
 *     module silently no-ops and the client continues with anon-only
 *     auth (current behavior).
 *   - If a request to PostgREST returns 401 because the JWT is
 *     malformed/expired, we clear the cached JWT and let the next
 *     mint attempt re-acquire it.
 *
 * Never blocks the auth flow. Never throws into sign-in / sign-up.
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { supabase, setBridgeAccessToken } from "../supabase/client";
import { getBetterAuthToken } from "./identity";

const STORAGE_KEY = "dvnt-supabase-jwt-v1";
// Refresh when within this window of expiry to avoid race conditions.
const REFRESH_WINDOW_SECONDS = 10 * 60;

interface MintedJwt {
  accessToken: string;
  expiresAt: number; // unix seconds
}

let cached: MintedJwt | null = null;
let inflight: Promise<MintedJwt | null> | null = null;

async function storageGet(): Promise<MintedJwt | null> {
  try {
    let raw: string | null = null;
    if (Platform.OS === "web") {
      raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(STORAGE_KEY)
          : null;
    } else {
      raw = await SecureStore.getItemAsync(STORAGE_KEY);
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.accessToken === "string" &&
      typeof parsed.expiresAt === "number"
    ) {
      return parsed as MintedJwt;
    }
  } catch {
    // ignore — fall through to mint
  }
  return null;
}

async function storageSet(value: MintedJwt | null): Promise<void> {
  try {
    if (value == null) {
      if (Platform.OS === "web") {
        if (typeof window !== "undefined")
          window.localStorage.removeItem(STORAGE_KEY);
      } else {
        await SecureStore.deleteItemAsync(STORAGE_KEY);
      }
      return;
    }
    const raw = JSON.stringify(value);
    if (Platform.OS === "web") {
      if (typeof window !== "undefined")
        window.localStorage.setItem(STORAGE_KEY, raw);
    } else {
      await SecureStore.setItemAsync(STORAGE_KEY, raw);
    }
  } catch {
    // ignore — storage is opportunistic, in-memory cache is the
    // authoritative source within a session.
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function isFresh(jwt: MintedJwt | null): boolean {
  return !!jwt && jwt.expiresAt - nowSeconds() > REFRESH_WINDOW_SECONDS;
}

/**
 * Mint a fresh Supabase JWT against the bridge edge fn. Returns null
 * if the bridge is disabled, the Better Auth token is missing, or any
 * network/server error occurs — caller should treat null as "stay in
 * anon-only mode" and continue.
 */
async function mintRemote(): Promise<MintedJwt | null> {
  try {
    const token = await getBetterAuthToken();
    if (!token) return null;

    const supabaseUrl =
      process.env.EXPO_PUBLIC_SUPABASE_URL ||
      "https://npfjanxturvmjyevoyfo.supabase.co";
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

    // ponytail: hard timeout so a hung/cold-starting mint edge fn can't freeze
    // callers. This runs on the publish path (createEvent awaits it) — a
    // never-resolving fetch here shows as "stuck on publishing" on web+mobile.
    // On abort we fall through to null → anon-only, exactly like any mint error.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(
        `${supabaseUrl}/functions/v1/mint-supabase-jwt`,
        {
          method: "POST",
          headers: {
            // x-auth-token avoids the Supabase gateway rejecting a
            // non-JWT in Authorization (the verify-session helper
            // accepts both).
            "x-auth-token": token,
            apikey: anonKey,
            "Content-Type": "application/json",
          },
          body: "{}",
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      // 503 = bridge intentionally disabled (no JWT secret); silent fallback.
      // Other 4xx/5xx — log and fall through.
      if (res.status !== 503) {
        console.warn(
          "[SupabaseJwt] mint failed:",
          res.status,
          await res.text().catch(() => ""),
        );
      }
      return null;
    }
    const body = await res.json();
    if (!body?.ok || !body?.data?.access_token) return null;
    return {
      accessToken: body.data.access_token as string,
      expiresAt: Number(body.data.expires_at) || 0,
    };
  } catch (err) {
    console.warn("[SupabaseJwt] mint error:", err);
    return null;
  }
}

/**
 * Attach the JWT to the supabase-js client so PostgREST sees us as
 * `authenticated`. Uses setSession so the JWT goes in Authorization
 * for every subsequent supabase.from(...) call. anon key still goes
 * in `apikey` so the gateway accepts the request.
 *
 * Refresh-token is unused (we re-mint via this module instead of
 * letting supabase-js try to auto-refresh against a non-Supabase
 * auth source), so we pass a sentinel value. supabase-js will fail
 * its own refresh attempts silently — that's intentional, we own
 * refresh.
 */
async function attachToSupabaseClient(jwt: MintedJwt | null): Promise<void> {
  try {
    // Web: feed the token to the client's `accessToken` option. NO setSession —
    // setSession triggers GoTrue /auth/v1/user validation, which 400s for a
    // bridged token and drops the session → writes go out as anon → 401. (See
    // client.web.ts.) Passing null reverts to the anon key.
    if (Platform.OS === "web") {
      setBridgeAccessToken(jwt ? jwt.accessToken : null);
      return;
    }
    // Native keeps setSession (no accessToken option there).
    if (jwt) {
      await supabase.auth.setSession({
        access_token: jwt.accessToken,
        refresh_token: "dvnt-better-auth-bridge",
      });
    } else {
      // Clear any prior JWT. After signOut() the client reverts to
      // anon key in Authorization, which is the pre-bridge behavior.
      await supabase.auth.signOut().catch(() => {});
    }
  } catch (err) {
    // Never let this throw into the auth flow.
    console.warn("[SupabaseJwt] attach error:", err);
  }
}

/**
 * Ensure a fresh JWT is cached + attached to the supabase client.
 * Idempotent + concurrency-safe (in-flight de-duping). Safe to call
 * on every cold start, after sign-in, and on a recurring timer.
 * Returns true if an authenticated JWT is now active, false if we
 * fell back to anon-only.
 */
export async function ensureSupabaseJwt(): Promise<boolean> {
  // 1. In-memory cache hit
  if (isFresh(cached)) return true;

  // 2. Persisted cache hit (cold start)
  if (cached == null) {
    const stored = await storageGet();
    if (isFresh(stored)) {
      cached = stored;
      await attachToSupabaseClient(stored);
      return true;
    }
  }

  // 3. Coalesce concurrent mint requests
  if (inflight) {
    const v = await inflight;
    return v != null;
  }
  inflight = mintRemote();
  try {
    const minted = await inflight;
    if (minted) {
      cached = minted;
      await storageSet(minted);
      await attachToSupabaseClient(minted);
      return true;
    }
    // mint failed — clear stale state, fall back to anon
    cached = null;
    await storageSet(null);
    await attachToSupabaseClient(null);
    return false;
  } finally {
    inflight = null;
  }
}

/**
 * Drop the cached JWT and detach from the supabase client. Call this
 * on Better Auth sign-out so the next user (or anon state) doesn't
 * inherit the previous user's authenticated session.
 */
export async function clearSupabaseJwt(): Promise<void> {
  cached = null;
  await storageSet(null);
  await attachToSupabaseClient(null);
}

/**
 * Called by client code that sees a 401 from a supabase.* request —
 * the JWT was rejected (most likely expired or signed with a stale
 * secret). Drop the cache + retry mint once. Safe to call repeatedly;
 * the in-flight guard prevents thundering herd.
 */
export async function reauthAfter401(): Promise<boolean> {
  cached = null;
  await storageSet(null);
  return ensureSupabaseJwt();
}
