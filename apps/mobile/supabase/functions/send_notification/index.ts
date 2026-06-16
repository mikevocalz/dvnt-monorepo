/**
 * Send Push Notification Edge Function
 *
 * Sends push notifications to users:
 * - Regular notifications → Expo Push Service
 * - Call notifications (iOS VoIP) → Apple APNs directly for instant wake
 * - Call notifications (Android/iOS fallback) → Expo Push Service with high priority
 *
 * Called by database triggers or directly from the app
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const APNS_PRODUCTION_URL = "https://api.push.apple.com";

// ── APNs JWT Token Generation ───────────────────────────────────────────
// Uses the .p8 auth key stored in Supabase secrets to sign APNs JWTs

let _cachedApnsJwt: { token: string; expiry: number } | null = null;

async function getApnsJwt(): Promise<string | null> {
  // Return cached token if still valid (tokens last 60 min, we refresh at 50)
  if (_cachedApnsJwt && Date.now() < _cachedApnsJwt.expiry) {
    return _cachedApnsJwt.token;
  }

  const keyId = Deno.env.get("APNS_KEY_ID");
  const teamId = Deno.env.get("APNS_TEAM_ID");
  const authKeyPem = Deno.env.get("APNS_AUTH_KEY");

  if (!keyId || !teamId || !authKeyPem) {
    console.error(
      "[send_notification] Missing APNs secrets (APNS_KEY_ID, APNS_TEAM_ID, APNS_AUTH_KEY)",
    );
    return null;
  }

  try {
    // Parse the PEM key
    const pemContents = authKeyPem
      .replace("-----BEGIN PRIVATE KEY-----", "")
      .replace("-----END PRIVATE KEY-----", "")
      .replace(/\s/g, "");
    const keyData = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    // Import the key for ES256 signing
    const key = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );

    // Create JWT header and payload
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "ES256", kid: keyId };
    const payload = { iss: teamId, iat: now };

    const encodedHeader = btoa(JSON.stringify(header))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const encodedPayload = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const encoder = new TextEncoder();

    // Sign with ECDSA P-256
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(signingInput),
    );

    // Convert DER signature to raw r||s format for JWT
    const sigBytes = new Uint8Array(signature);
    const encodedSig = btoa(String.fromCharCode(...sigBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const jwt = `${signingInput}.${encodedSig}`;

    // Cache for 50 minutes (APNs tokens valid for 60)
    _cachedApnsJwt = { token: jwt, expiry: Date.now() + 50 * 60 * 1000 };
    return jwt;
  } catch (error) {
    console.error("[send_notification] Failed to generate APNs JWT:", error);
    return null;
  }
}

// ── Send VoIP Push via APNs ─────────────────────────────────────────────

async function sendApnsVoipPush(
  deviceToken: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const jwt = await getApnsJwt();
  if (!jwt) {
    return { ok: false, error: "Failed to generate APNs JWT" };
  }

  const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "com.dvnt.app";
  const apnsPayload = {
    aps: {
      alert: {
        title: payload.title,
        body: payload.body,
      },
      "content-available": 1,
    },
    // Custom data for the app to extract in AppDelegate
    callerName: payload.callerName || "Unknown",
    handle: payload.handle || "Unknown",
    hasVideo: payload.hasVideo || false,
    roomId: payload.roomId,
    callerId: payload.callerId,
    callerUsername: payload.callerUsername,
    callerAvatar: payload.callerAvatar,
    callType: payload.callType,
    type: "call",
  };

  try {
    const response = await fetch(
      `${APNS_PRODUCTION_URL}/3/device/${deviceToken}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `bearer ${jwt}`,
          "apns-topic": `${bundleId}.voip`,
          "apns-push-type": "voip",
          "apns-priority": "10", // Immediate delivery
          "apns-expiration": "0", // Don't store if device offline
        },
        body: JSON.stringify(apnsPayload),
      },
    );

    if (response.ok) {
      console.log(
        `[send_notification] APNs VoIP push sent to ${deviceToken.substring(0, 10)}...`,
      );
      return { ok: true };
    } else {
      const errorBody = await response.text();
      console.error(
        `[send_notification] APNs error ${response.status}: ${errorBody}`,
      );
      return { ok: false, error: `APNs ${response.status}: ${errorBody}` };
    }
  } catch (error) {
    console.error("[send_notification] APNs fetch error:", error);
    return { ok: false, error: error.message };
  }
}

interface PushNotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  type:
    | "follow"
    | "follow_request"
    | "like"
    | "comment"
    | "mention"
    | "tag"
    | "message"
    | "dm"
    | "event"
    | "event_invite"
    | "event_update"
    | "ticket"
    | "sneaky_lynk"
    | "room_invite"
    | "post"
    | "call";
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high"; // For Android
  categoryId?: string; // For iOS categories
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const payload: PushNotificationPayload = await req.json();
    const { userId, title, body, data, type } = payload;

    if (!userId || !title || !body || !type) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: userId, title, body, type",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // userId is the INTEGER user ID (users.id)
    const recipientId = typeof userId === "string" ? parseInt(userId) : userId;
    const actorId = data?.actorId
      ? typeof data.actorId === "string"
        ? parseInt(data.actorId as string)
        : (data.actorId as number)
      : null;

    console.log(
      `[send_notification] Sending ${type} notification to user ${recipientId}`,
    );

    // 1. Store notification in database (matches actual schema).
    // Do this before push-token lookup so users still see in-app Activity
    // entries even if this device has not registered a push token yet.
    if (type !== "call") {
      const { error: notifError } = await supabase
        .from("notifications")
        .insert({
          recipient_id: recipientId,
          actor_id: actorId,
          type,
          entity_type: data?.entityType || null,
          entity_id: data?.entityId ? String(data.entityId) : null,
        });

      if (notifError) {
        console.error(
          "[send_notification] Error storing notification:",
          notifError,
        );
        // Continue anyway - push notification is still useful.
      }
    }

    // 2. Get user's push tokens (push_tokens.user_id is INTEGER)
    const { data: tokens, error: tokenError } = await supabase
      .from("push_tokens")
      .select("token, platform")
      .eq("user_id", recipientId);

    if (tokenError) {
      console.error("[send_notification] Error fetching tokens:", tokenError);
      return new Response(
        JSON.stringify({ error: "Failed to fetch push tokens" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!tokens || tokens.length === 0) {
      console.log("[send_notification] No push tokens found for user");
      return new Response(
        JSON.stringify({
          ok: true,
          sent: 0,
          message: "No push tokens registered",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Route notifications based on type and platform
    const isCallNotification = type === "call";

    // Split tokens: VoIP tokens go to APNs, regular tokens go to Expo Push
    const voipTokens = tokens.filter((t) => t.platform === "ios_voip");
    const expoTokens = tokens.filter((t) => t.platform !== "ios_voip");

    let totalSent = 0;
    let totalFailed = 0;
    const allErrors: string[] = [];

    // ── 3a. Send VoIP push via APNs for iOS call notifications ──────────
    if (isCallNotification && voipTokens.length > 0) {
      console.log(
        `[send_notification] Sending VoIP push to ${voipTokens.length} iOS device(s)`,
      );
      const voipPayload = {
        title,
        body,
        callerName: data?.callerUsername || "Unknown",
        handle: data?.callerUsername || "Unknown",
        hasVideo: data?.callType === "video",
        roomId: data?.roomId,
        callerId: data?.callerId,
        callerUsername: data?.callerUsername,
        callerAvatar: data?.callerAvatar,
        callType: data?.callType,
      };

      const voipResults = await Promise.all(
        voipTokens.map((t) => sendApnsVoipPush(t.token, voipPayload)),
      );

      for (const result of voipResults) {
        if (result.ok) {
          totalSent++;
        } else {
          totalFailed++;
          if (result.error) allErrors.push(result.error);
        }
      }
    }

    // ── 3b. Send via Expo Push Service (regular tokens + Android calls) ─
    if (expoTokens.length > 0) {
      // For call notifications, skip Expo push for iOS tokens since VoIP handles it
      // But still send to Android tokens and any iOS tokens without VoIP
      const messages: ExpoPushMessage[] = expoTokens.map((t) => ({
        to: t.token,
        title,
        body,
        data: { ...data, type },
        sound: "default",
        channelId: isCallNotification ? "calls" : "default",
        priority: isCallNotification ? "high" : "default",
        categoryId: isCallNotification ? "CALL" : undefined,
      }));

      const expoResponse = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(messages),
      });

      const expoResult = await expoResponse.json();
      console.log(
        "[send_notification] Expo response:",
        JSON.stringify(expoResult),
      );

      const expoErrors =
        expoResult.data?.filter((r: any) => r.status === "error") || [];
      totalSent += expoTokens.length - expoErrors.length;
      totalFailed += expoErrors.length;
      if (expoErrors.length > 0) {
        console.error(
          "[send_notification] Some Expo notifications failed:",
          expoErrors,
        );
        allErrors.push(...expoErrors.map((e: any) => e.message));
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        sent: totalSent,
        failed: totalFailed,
        errors: allErrors,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[send_notification] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
