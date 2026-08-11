import { createClient } from "@supabase/supabase-js";

const FALLBACK_SUPABASE_URL = "https://npfjanxturvmjyevoyfo.supabase.co";

// Fallback anon key for the SAME public project as FALLBACK_SUPABASE_URL.
// This is intentionally the browser-facing "anon" JWT — it is designed to
// be embedded in a client bundle and is protected server-side by RLS. It
// is NOT a service_role key and does not grant any privilege beyond what
// an unauthenticated visitor has.
//
// Why we ship it as a constant: on Vercel the NEXT_PUBLIC_* Supabase env
// vars were never configured, so every build inlined the empty-key
// placeholder ("anon-key-unset-at-build") into the client bundle. Every
// browser-side supabase call then silently failed — publishing a story,
// creating a post, and creating an event all appeared to "not do
// anything" because the writes never reached the DB. Committing the
// public anon key as a build-time fallback closes this class of
// deployment misconfiguration without giving up any secret material.
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZmphbnh0dXJ2bWp5ZXZveWZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg0MjA0MjMsImV4cCI6MjA4Mzk5NjQyM30.v88MMGqv2db8hn8llr5aToKbKUDOHz-AxZbZYA5RLGM";

// Web reads import.meta.env.VITE_* first, then falls back to EXPO_PUBLIC_*
// (injected into the bundle via Vite `define`) so existing .env keys keep
// working. (PROMPT 0 §3.)
const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> })
  .env ?? {}) as Record<string, string | undefined>;

// Next.js (apps/web) only inlines `process.env.NEXT_PUBLIC_*` into client
// bundles — `EXPO_PUBLIC_*` is undefined in the browser there, which made
// every supabase call land at the FALLBACK_SUPABASE_URL with a placeholder
// anon key and surface as a generic "Failed to send a request to the Edge
// Function" toast. Vite (web-vite) uses VITE_*, native bundler (mobile)
// uses EXPO_PUBLIC_*. Read in priority so each host wins.
const rawUrl =
  viteEnv.VITE_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseUrl =
  typeof rawUrl === "string" && rawUrl.startsWith("https://")
    ? rawUrl
    : FALLBACK_SUPABASE_URL;

const rawAnonKey =
  viteEnv.VITE_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const supabaseAnonKey =
  typeof rawAnonKey === "string" && rawAnonKey.startsWith("eyJ")
    ? rawAnonKey
    : FALLBACK_SUPABASE_ANON_KEY;

// Fall back cleanly to the committed anon key rather than a placeholder
// string that trips supabase-js at runtime — writes and reads keep
// working even when the env var isn't wired.
const clientKey = supabaseAnonKey;

// SSR-safe: on the Next.js server `localStorage` is undefined. Guard every
// access so supabase's session bootstrap / auto-refresh tick can't crash the
// render with "Cannot read properties of undefined (reading 'getItem')".
const hasLocalStorage = (): boolean => typeof localStorage !== "undefined";

const LocalStorageAdapter = {
  getItem: (key: string) => (hasLocalStorage() ? localStorage.getItem(key) : null),
  setItem: (key: string, value: string) => {
    if (hasLocalStorage()) localStorage.setItem(key, value);
  },
  removeItem: (key: string) => {
    if (hasLocalStorage()) localStorage.removeItem(key);
  },
};

// Better Auth owns sign-in; the supabase-jwt bridge mints a short-lived JWT.
// We attach it via the `accessToken` option — the supported third-party-auth
// integration — instead of supabase.auth.setSession().
//
// Why not setSession: setSession makes GoTrue validate the token against
// /auth/v1/user (and, with autoRefresh, hit /token). A BRIDGED token is not a
// real GoTrue session, so /auth/v1/user returns 400 and supabase-js silently
// drops the session — every subsequent supabase.from(...) then goes out as
// `anon`, so INSERTs (authenticated-only, e.g. events) 401 and event publish
// fails fast. `accessToken` attaches the token per request with NO GoTrue
// session, NO /auth/v1/user validation, and NO navigator.locks — exactly what a
// non-Supabase auth source needs. When no token is set we return the anon key
// so unauthenticated reads still work.
let _bridgeToken: string | null = null;
export function setBridgeAccessToken(token: string | null): void {
  _bridgeToken = token;
}

/**
 * Read the `exp` claim without verifying — we are not trusting this token, only
 * deciding whether it is worth sending. Returns null for anything unparseable.
 */
function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

/**
 * The bridged token is minted by `supabase-jwt.ts`, which re-mints on a timer.
 * When that mint fails — the edge fn is cold, offline, or a privacy extension
 * kills the request — the LAST token stays attached here and every subsequent
 * PostgREST call goes out with a dead bearer and comes back 401. Callers like
 * `getNewestUsers` catch and return `[]`, so the symptom is a signed-in user
 * seeing empty sections ("No new profiles to discover right now") while a
 * signed-out visitor sees everything. Anon can read those tables; a rejected
 * JWT cannot.
 *
 * So: an expired token is worse than no token. Drop it and fall back to the
 * anon key, which is exactly the pre-bridge behaviour.
 *
 * ponytail: 30s of slack absorbs clock skew. This does not re-mint — that is
 * `ensureSupabaseJwt`'s job on its own timer; this only stops us sending a
 * bearer we already know is dead.
 */
function usableBridgeToken(): string | null {
  if (!_bridgeToken) return null;
  const exp = jwtExpiry(_bridgeToken);
  if (exp != null && exp - 30 <= Math.floor(Date.now() / 1000)) {
    _bridgeToken = null;
    return null;
  }
  return _bridgeToken;
}

// Same-origin edge-function proxy (Next only — gated on the same env flag the
// auth proxy uses; web-vite has no /api/fn rewrite). Cross-origin calls to
// supabase.co/functions/v1 get killed by privacy extensions / flaky networks
// as a raw fetch failure ("Failed to send a request to the Edge Function").
// Rewriting them onto this origin makes every edge call first-party; Next
// proxies /api/fn/* to the functions host server-side.
const FN_SAME_ORIGIN =
  process.env.EXPO_PUBLIC_AUTH_SAME_ORIGIN === "true" &&
  typeof window !== "undefined";
const FN_PREFIX = `${supabaseUrl}/functions/v1/`;

const proxiedFetch: typeof fetch = (input, init) => {
  if (FN_SAME_ORIGIN) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.startsWith(FN_PREFIX)) {
      const proxied = `${window.location.origin}/api/fn/${url.slice(FN_PREFIX.length)}`;
      if (typeof input === "object" && !(input instanceof URL)) {
        return fetch(new Request(proxied, input as Request), init);
      }
      return fetch(proxied, init);
    }
  }
  return fetch(input as RequestInfo, init);
};

export const supabase = createClient(supabaseUrl, clientKey, {
  accessToken: async () => usableBridgeToken() ?? clientKey,
  global: { fetch: proxiedFetch },
});

console.log("[Supabase] Web client initialized (accessToken bridge)");
