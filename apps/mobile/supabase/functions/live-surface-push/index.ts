/**
 * live-surface-push — WS-1 Live Activity APNs sender.
 *
 * Sends Apple Push Notification service (APNs) `liveactivity` pushes so the
 * server can START a DVNT Live Activity remotely (push-to-start) or update one
 * while the app is backgrounded — which the foreground-only client
 * `updateLiveActivity` cannot do.
 *
 * The APNs JWT signing (ES256 over the .p8 auth key) is the SAME verified path
 * used for VoIP calls in send_notification/index.ts (see that file, getApnsJwt
 * lines 23-97 and sendApnsVoipPush lines 101-160). The only differences here are
 * the topic (`<bundle>.push-type.liveactivity`) and apns-push-type
 * (`liveactivity`).
 *
 * Secrets required (already provisioned for VoIP — no new credentials invented):
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY (.p8 PEM), APNS_BUNDLE_ID (optional,
 *   defaults com.dvnt.app). If any are missing, the send path STOPS behind a
 *   clear guard (503) and nothing is sent.
 *
 * Caller auth (I4): internal only — service-role bearer, or x-internal-secret
 * matching INTERNAL_FN_SECRET. Fails CLOSED if INTERNAL_FN_SECRET is unset.
 * verify_jwt = false in config.toml (webhook-style/no-JWT caller).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APNS_PRODUCTION_URL = "https://api.push.apple.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-internal-secret",
};

// ── APNs JWT (ES256) — verified pattern from send_notification/index.ts ──────

let _cachedApnsJwt: { token: string; expiry: number } | null = null;

async function getApnsJwt(): Promise<string | null> {
  if (_cachedApnsJwt && Date.now() < _cachedApnsJwt.expiry) {
    return _cachedApnsJwt.token;
  }

  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const authKeyPem = Deno.env.get("APNS_AUTH_KEY");

  if (!keyId || !teamId || !authKeyPem) {
    console.error(
      "[live-surface-push] Missing APNs secrets (APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY)",
    );
    return null;
  }

  try {
    const pemContents = authKeyPem
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\s/g, "");
    const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    const key = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", kid: keyId };
    const payload = { iss: teamId, iat: now };

    const b64url = (s: string) =>
      btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const encodedHeader = b64url(JSON.stringify(header));
    const encodedPayload = b64url(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput),
    );
    const sigBytes = new Uint8Array(signature);
    const encodedSig = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const jwt = `${signingInput}.${encodedSig}`;
    _cachedApnsJwt = { token: jwt, expiry: Date.now() + 50 * 60 * 1000 };
    return jwt;
  } catch (error) {
    console.error("[live-surface-push] Failed to generate APNs JWT:", error);
    return null;
  }
}

// ── Send a Live Activity push (start / update / end) to one token ────────────

interface LiveActivityPush {
  event: "start" | "update" | "end";
  contentState: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  attributesType?: string;
  alert?: { title: string; body: string };
  staleDate?: number; // unix seconds
  dismissalDate?: number; // unix seconds (end only)
}

async function sendApnsLiveActivity(
  deviceToken: string,
  push: LiveActivityPush,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const jwt = await getApnsJwt();
  if (!jwt) return { ok: false, error: "apns_not_configured" };

  const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "com.dvnt.app";

  const aps: Record<string, unknown> = {
    timestamp: Math.floor(Date.now() / 1000),
    event: push.event,
    "content-state": push.contentState,
  };
  if (push.event === "start") {
    aps["attributes-type"] = push.attributesType;
    aps["attributes"] = push.attributes ?? {};
  }
  if (push.alert) aps.alert = push.alert;
  if (push.staleDate != null) aps["stale-date"] = push.staleDate;
  if (push.event === "end" && push.dismissalDate != null) {
    aps["dismissal-date"] = push.dismissalDate;
  }

  try {
    const response = await fetch(
      `${APNS_PRODUCTION_URL}/3/device/${deviceToken}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `bearer ${jwt}`,
          "apns-topic": `${bundleId}.push-type.liveactivity`,
          "apns-push-type": "liveactivity",
          "apns-priority": "10",
        },
        body: JSON.stringify({ aps }),
      },
    );

    if (response.ok) return { ok: true, status: response.status };
    const errorBody = await response.text();
    console.error(
      `[live-surface-push] APNs error ${response.status}: ${errorBody}`,
    );
    return { ok: false, status: response.status, error: errorBody };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

interface RequestBody {
  /** Resolve push-to-start tokens from live_activity_push_tokens for this user. */
  userId?: number | string;
  /** Or send to explicit token(s), bypassing the table lookup. */
  tokens?: string[];
  event?: "start" | "update" | "end";
  contentState: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  attributesType?: string;
  alert?: { title: string; body: string };
  staleDate?: number;
  dismissalDate?: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth gate: internal callers ONLY (I4, fail closed) ──────────────
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace("Bearer ", "").trim();
    const isServiceRole =
      bearer.length > 0 &&
      supabaseServiceKey.length > 0 &&
      bearer === supabaseServiceKey;

    if (!isServiceRole) {
      const internalSecret = Deno.env.get("INTERNAL_FN_SECRET") || "";
      if (!internalSecret) {
        console.error(
          "[live-surface-push] INTERNAL_FN_SECRET unset and caller not service-role — rejecting",
        );
        return new Response(JSON.stringify({ error: "Misconfigured" }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
      const provided = req.headers.get("x-internal-secret") || "";
      if (provided !== internalSecret) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // ── Guard: APNs must be configured before we do anything else ────────
    const apnsReady =
      !!Deno.env.get("APNS_KEY_ID") &&
      !!Deno.env.get("APNS_TEAM_ID") &&
      !!Deno.env.get("APNS_AUTH_KEY");
    if (!apnsReady) {
      return new Response(
        JSON.stringify({
          error: "apns_not_configured",
          detail:
            "Set APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY (.p8 PEM) as Edge Function secrets. Reused from the VoIP push config.",
        }),
        {
          status: 503,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    const body: RequestBody = await req.json();
    const event = body.event ?? "start";

    if (!body.contentState) {
      return new Response(
        JSON.stringify({ error: "Missing required field: contentState" }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }
    if (event === "start" && !body.attributesType) {
      return new Response(
        JSON.stringify({
          error: "start event requires attributesType (and attributes)",
        }),
        {
          status: 400,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    // Resolve target tokens.
    let tokens: string[] = Array.isArray(body.tokens) ? body.tokens : [];
    if (tokens.length === 0 && body.userId != null) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          headers: { Authorization: `Bearer ${supabaseServiceKey}` },
        },
      });
      const recipientId =
        typeof body.userId === "string" ? parseInt(body.userId) : body.userId;
      const { data, error } = await supabase
        .from("live_activity_push_tokens")
        .select("tokens")
        .eq("user_id", recipientId)
        .maybeSingle();
      if (error) {
        console.error("[live-surface-push] token lookup failed:", error);
        return new Response(
          JSON.stringify({ error: "Failed to fetch push-to-start tokens" }),
          {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          },
        );
      }
      tokens = data?.tokens ?? [];
    }

    if (tokens.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sent: 0, note: "no tokens for target" }),
        {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    const push: LiveActivityPush = {
      event,
      contentState: body.contentState,
      attributes: body.attributes,
      attributesType: body.attributesType,
      alert: body.alert,
      staleDate: body.staleDate,
      dismissalDate: body.dismissalDate,
    };

    const results = await Promise.all(
      tokens.map((t) => sendApnsLiveActivity(t, push)),
    );
    const sent = results.filter((r) => r.ok).length;

    return new Response(
      JSON.stringify({ ok: true, sent, total: tokens.length, results }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("[live-surface-push] error:", error);
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
