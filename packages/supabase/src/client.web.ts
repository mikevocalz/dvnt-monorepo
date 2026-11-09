import { resolveWebBackend } from "./web-backend.cjs";
import { createClient } from "@supabase/supabase-js";
import { withFunctionObserver } from "./function-observer";
import { createBridgeTransport } from "./bridge-transport";
import { createRealtimeAuthController } from "./realtime-auth";

export { setFunctionResponseObserver } from "./function-observer";

// Keep direct property reads: Next statically inlines NEXT_PUBLIC_* values.
const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> })
  .env ?? {}) as Record<string, string | undefined>;
const { supabaseUrl, supabaseAnonKey: clientKey } = resolveWebBackend(
  viteEnv.VITE_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL,
  viteEnv.VITE_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
);

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
