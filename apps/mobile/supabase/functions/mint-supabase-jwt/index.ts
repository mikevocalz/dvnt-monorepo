/**
 * mint-supabase-jwt Edge Function
 *
 * POST /mint-supabase-jwt
 * Body: {} (Authorization header carries the Better Auth session token)
 *
 * Verifies the Better Auth session via the existing DB lookup pattern
 * (`verifySession`), then issues a short-lived HS256-signed JWT in the
 * Supabase access-token format so PostgREST will treat the request as
 * the `authenticated` role with `sub = <better-auth-user-id>`.
 *
 * This is the SECONDARY auth layer that lives alongside Better Auth.
 * Better Auth is still the source of truth for sign-in / sign-up /
 * session lifecycle. This function only mints an extra JWT that the
 * client can attach to supabase-js calls to upgrade from `anon` to
 * `authenticated` and unlock the host-id-checking RLS policies.
 *
 * If DVNT_JWT_SECRET is not configured (the bridge hasn't been
 * enabled yet), the function returns 503 — the client is built to
 * fall back to anon-only when minting fails, so the app keeps working
 * during the rollout window before the secret is set. The Supabase
 * CLI reserves the SUPABASE_ prefix, hence the DVNT_ name.
 *
 * Returns:
 *   { ok: true, data: { access_token, expires_at } }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// Supabase CLI reserves the SUPABASE_ prefix for its own env vars and
// refuses `secrets set SUPABASE_*`. We use DVNT_JWT_SECRET as the
// operator-set name and read both for backwards-compatibility.
const SUPABASE_JWT_SECRET =
  Deno.env.get("DVNT_JWT_SECRET") ||
  Deno.env.get("SUPABASE_JWT_SECRET") ||
  "";

const EXPIRY_SECONDS = 60 * 60; // 1 hour — matches Supabase default

function json(data: unknown, status = 200, req?: Request) {
  const headers = req
    ? { ...corsHeaders(req), "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
  return new Response(JSON.stringify(data), { status, headers });
}

function base64urlEncode(input: string | Uint8Array): string {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signHs256(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)),
  );
  return `${data}.${base64urlEncode(sig)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST")
    return json(
      { ok: false, error: { message: "Method not allowed" } },
      405,
      req,
    );

  try {
    if (!SUPABASE_JWT_SECRET) {
      // Bridge not enabled yet. Client falls back to anon-only.
      return json(
        {
          ok: false,
          error: {
            code: "bridge_disabled",
            message:
              "Supabase JWT bridge is not configured. SUPABASE_JWT_SECRET secret is missing.",
          },
        },
        503,
        req,
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const authId = await verifySession(supabase, req);
    if (!authId) {
      return json(
        { ok: false, error: { message: "Unauthorized" } },
        401,
        req,
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + EXPIRY_SECONDS;

    // Standard Supabase access-token claims. PostgREST reads `role`
    // and `sub`; the rest are for client-side telemetry / debugging.
    const payload = {
      iss: "supabase",
      ref: SUPABASE_URL.replace(/^https?:\/\//, "").split(".")[0],
      role: "authenticated",
      aud: "authenticated",
      sub: authId,
      iat: now,
      exp,
      app_metadata: { provider: "better-auth" },
      user_metadata: {},
    };

    const access_token = await signHs256(payload, SUPABASE_JWT_SECRET);

    // Self-test: confirm PostgREST accepts our signature before we
    // hand the token back to the client. If the operator set the
    // wrong value as DVNT_JWT_SECRET (e.g. an `sb_secret_*` publishable
    // API key instead of the legacy HS256 JWT secret), PostgREST
    // returns 401 with code PGRST301 / "No suitable key or wrong key
    // type". We catch that here and return 503 so the client stays
    // in anon-only fallback rather than attaching a token that will
    // 401 every subsequent request and effectively brick reads.
    try {
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      // GET against a real table with limit=0 — HEAD got
      // short-circuited at the gateway before JWT verification ran,
      // so a wrong secret slipped through. limit=0 keeps the
      // response tiny and doesn't require any rows to exist.
      const probeRes = await fetch(
        `${SUPABASE_URL}/rest/v1/users?select=id&limit=0`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${access_token}`,
            apikey: anonKey,
            Accept: "application/json",
          },
        },
      );
      const probeBody = await probeRes.text();
      if (probeRes.status === 401) {
        const isSignatureProblem =
          probeBody.includes("PGRST301") ||
          probeBody.includes("No suitable key") ||
          probeBody.includes("None of the keys was able to decode the JWT") ||
          probeBody.includes("InvalidJWTToken") ||
          probeBody.includes("invalid signature");
        if (isSignatureProblem) {
          console.error(
            "[mint-supabase-jwt] PostgREST rejected our signature — DVNT_JWT_SECRET is the wrong value. Probe response:",
            probeBody.slice(0, 200),
          );
          return json(
            {
              ok: false,
              error: {
                code: "wrong_jwt_secret",
                message:
                  "Bridge is disabled because the configured DVNT_JWT_SECRET is not the legacy HS256 JWT signing secret. Set the value from Project Settings → API → JWT Settings → Legacy JWT secret.",
              },
            },
            503,
            req,
          );
        }
        // Some other 401 (RLS denial, etc.) — signature is valid;
        // let the client proceed.
      }
    } catch (probeErr) {
      // Probe network error — fail open. The client's existing 401
      // handling will catch any real downstream problem.
      console.warn("[mint-supabase-jwt] probe error (non-fatal):", probeErr);
    }

    return json(
      {
        ok: true,
        data: {
          access_token,
          expires_at: exp,
          expires_in: EXPIRY_SECONDS,
        },
      },
      200,
      req,
    );
  } catch (err: any) {
    console.error("[mint-supabase-jwt] unexpected:", err);
    return json(
      { ok: false, error: { message: err?.message || "Internal error" } },
      500,
      req,
    );
  }
});
