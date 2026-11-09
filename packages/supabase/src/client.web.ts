import { createClient } from "@supabase/supabase-js";
import { withFunctionObserver } from "./function-observer";
import { createBridgeTransport } from "./bridge-transport";
import { createRealtimeAuthController } from "./realtime-auth";

export { setFunctionResponseObserver } from "./function-observer";

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

// The resolver validates the active Better Auth session on every request.
const bridge = createBridgeTransport(clientKey);
export function setBridgeAccessToken(token: string | null) {
  bridge.setToken(token);
  // Explicit anon reset also supersedes pending Realtime auth callbacks.
  void realtimeAuth.updateAuth(token ?? clientKey).catch(() => {
    console.warn("[Supabase] Realtime credential update failed");
  });
}
export const setBridgeTokenMinter = bridge.setMinter;
export const getBridgeRequestEpoch = bridge.requestEpoch;
const realtimeAuth = createRealtimeAuthController({
  accessToken: bridge.accessToken,
  requestEpoch: bridge.requestEpoch,
  anonKey: clientKey,
  setAuth: (token) => supabase.realtime.setAuth(token),
});
export const ensureBridgeRealtimeAuth = realtimeAuth.ensureBridgeRealtimeAuth;

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

/**
 * Functions that must NOT go through the same-origin /api/fn proxy.
 *
 * The proxy is a Next rewrite, so the whole request body passes through the
 * Next server — and a large body there dies with a bare "500 Internal Server
 * Error" (no JSON, nothing the client can explain to the user). Verified
 * 2026-09-13: a 19.8MB event-video POST to /api/fn/media-upload returned 500,
 * while the identical body + token + anon key sent straight to
 * supabase.co/functions/v1/media-upload returned 200 and stored the file.
 * Vercel also caps serverless request bodies at 4.5MB, so in production this
 * blocks EVERY video (they are always bigger) while letting small images
 * through — which is exactly the reported symptom: image flyers upload, video
 * flyers never do.
 *
 * media-upload is exempt so uploads go cross-origin. That is safe here: the
 * function answers OPTIONS with 204 and allows Authorization/apikey/Content-
 * Type/x-* in Access-Control-Allow-Headers, so the preflight passes. The
 * privacy-extension fragility the proxy exists to avoid costs us a retry at
 * worst; the proxy costs us the whole feature.
 */
const FN_PROXY_EXEMPT = ["media-upload"];

const proxiedFetch: typeof fetch = (input, init) => {
  if (FN_SAME_ORIGIN) {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const isExempt = FN_PROXY_EXEMPT.some((fn) =>
      url.startsWith(`${FN_PREFIX}${fn}`),
    );
    if (url.startsWith(FN_PREFIX) && !isExempt) {
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
  accessToken: bridge.accessToken,
  global: { fetch: withFunctionObserver(bridge.guardFetch(proxiedFetch)) },
});

console.log("[Supabase] Web client initialized (account-bound bridge)");
