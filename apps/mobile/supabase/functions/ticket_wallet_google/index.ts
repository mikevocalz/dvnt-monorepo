/**
 * Edge Function: ticket_wallet_google
 * Creates or retrieves a Google Wallet Event Ticket Object and returns a Save URL.
 *
 * Flow:
 * 1. Verify authenticated user via Better Auth session.
 * 2. Validate user owns the ticket.
 * 3. Create or retrieve Google Wallet Event Ticket Object.
 * 4. Return a Save URL that opens Google Wallet.
 *
 * NOTE: Requires a Google Wallet Issuer account and service account credentials.
 * These must be stored as Supabase secrets (GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_KEY).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string, status = 400): Response {
  console.error(`[Edge:ticket_wallet_google] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    // 1. Authenticate
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
        401,
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;
    console.log(
      "[Edge:ticket_wallet_google] Authenticated user auth_id:",
      authUserId,
    );

    // 2. Parse body
    let body: { ticketId: string; eventId: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { ticketId, eventId } = body;
    if (!ticketId || !eventId) {
      return errorResponse(
        "validation_error",
        "ticketId and eventId are required",
        400,
      );
    }

    // 3. Verify ticket ownership via Supabase

    // Get user's integer ID from auth_id (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    // TODO: Verify ticket exists in tickets table and belongs to this user
    // const { data: ticketData, error: ticketError } = await supabaseAdmin
    //   .from("tickets")
    //   .select("*")
    //   .eq("id", ticketId)
    //   .eq("user_id", userData.id)
    //   .single();
    //
    // if (ticketError || !ticketData) {
    //   return errorResponse("not_found", "Ticket not found or not owned by user");
    // }

    // 4. Create Google Wallet Event Ticket Object
    // TODO: Implement with Google Wallet API
    // Required secrets: GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SERVICE_ACCOUNT_KEY
    //
    // Steps:
    // a. Parse service account key from secret
    // b. Create a signed JWT for the Google Wallet API
    // c. Define Event Ticket Class (if not already created)
    // d. Create Event Ticket Object with:
    //    - Event name, date, venue
    //    - QR barcode with ticket token
    //    - Tier-based styling (colors, labels)
    // e. Generate Save URL: https://pay.google.com/gp/v/save/{jwt}
    //
    // For now, return a placeholder indicating setup is needed:

    const googleIssuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
    if (!googleIssuerId) {
      return errorResponse(
        "not_configured",
        "Google Wallet is not yet configured. Add GOOGLE_WALLET_ISSUER_ID and GOOGLE_WALLET_SERVICE_ACCOUNT_KEY secrets.",
        501,
      );
    }

    // When implemented, this would return:
    // const saveUrl = `https://pay.google.com/gp/v/save/${signedJwt}`;
    // return jsonResponse({
    //   ok: true,
    //   data: { saveUrl },
    // });

    return errorResponse(
      "not_implemented",
      "Google Wallet integration pending issuer account setup",
      501,
    );
  } catch (err) {
    console.error("[Edge:ticket_wallet_google] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
