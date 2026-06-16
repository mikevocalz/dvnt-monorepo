/**
 * Edge Function: wallet_web_service
 *
 * Implements Apple's PassKit Web Service protocol so that passes on user
 * devices can be updated or voided when ticket/event data changes.
 *
 * Apple's protocol endpoints (all under webServiceURL):
 *
 * POST   /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
 *   → Register a device to receive push updates for a pass.
 *
 * DELETE /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}
 *   → Unregister a device.
 *
 * GET    /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}?passesUpdatedSince={tag}
 *   → List serial numbers of passes that have been updated since {tag}.
 *
 * GET    /v1/passes/{passTypeIdentifier}/{serialNumber}
 *   → Deliver the latest version of a pass (returns .pkpass binary).
 *
 * POST   /v1/log
 *   → Receive log messages from devices (for debugging).
 *
 * Reference: https://developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
  });
}

// ── Route parsing ───────────────────────────────────────────────────

interface ParsedRoute {
  type:
    | "register"
    | "unregister"
    | "list_serials"
    | "get_pass"
    | "log"
    | "unknown";
  deviceLibraryId?: string;
  passTypeId?: string;
  serialNumber?: string;
  passesUpdatedSince?: string;
}

function parseRoute(req: Request): ParsedRoute {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // POST /v1/log
  if (method === "POST" && path.endsWith("/v1/log")) {
    return { type: "log" };
  }

  // Registration routes:
  // POST/DELETE /v1/devices/{did}/registrations/{ptid}/{serial}
  const regMatch = path.match(
    /\/v1\/devices\/([^/]+)\/registrations\/([^/]+)\/([^/]+)$/,
  );
  if (regMatch) {
    const [, deviceLibraryId, passTypeId, serialNumber] = regMatch;
    if (method === "POST") {
      return { type: "register", deviceLibraryId, passTypeId, serialNumber };
    }
    if (method === "DELETE") {
      return { type: "unregister", deviceLibraryId, passTypeId, serialNumber };
    }
  }

  // List serials:
  // GET /v1/devices/{did}/registrations/{ptid}?passesUpdatedSince={tag}
  const listMatch = path.match(
    /\/v1\/devices\/([^/]+)\/registrations\/([^/]+)$/,
  );
  if (listMatch && method === "GET") {
    const [, deviceLibraryId, passTypeId] = listMatch;
    const passesUpdatedSince =
      url.searchParams.get("passesUpdatedSince") || undefined;
    return {
      type: "list_serials",
      deviceLibraryId,
      passTypeId,
      passesUpdatedSince,
    };
  }

  // Get pass:
  // GET /v1/passes/{ptid}/{serial}
  const passMatch = path.match(/\/v1\/passes\/([^/]+)\/([^/]+)$/);
  if (passMatch && method === "GET") {
    const [, passTypeId, serialNumber] = passMatch;
    return { type: "get_pass", passTypeId, serialNumber };
  }

  return { type: "unknown" };
}

// ── Auth token verification ─────────────────────────────────────────
// Apple sends the authenticationToken from the pass in the Authorization header.

function getAuthToken(req: Request): string | null {
  const header = req.headers.get("Authorization") || "";
  if (header.startsWith("ApplePass ")) {
    return header.slice("ApplePass ".length).trim();
  }
  return null;
}

async function verifyPassAuth(
  db: any,
  serialNumber: string,
  passTypeId: string,
  authToken: string,
): Promise<boolean> {
  const { data } = await db
    .from("tickets")
    .select("id")
    .eq("wallet_serial_number", serialNumber)
    .eq("wallet_pass_type_id", passTypeId)
    .eq("wallet_auth_token", authToken)
    .single();
  return !!data;
}

// ── Handlers ────────────────────────────────────────────────────────

async function handleRegister(
  db: any,
  route: ParsedRoute,
  req: Request,
): Promise<Response> {
  const authToken = getAuthToken(req);
  if (!authToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ok = await verifyPassAuth(
    db,
    route.serialNumber!,
    route.passTypeId!,
    authToken,
  );
  if (!ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Parse push token from body
  let pushToken = "";
  try {
    const body = await req.json();
    pushToken = body.pushToken || "";
  } catch {
    // body may be empty
  }

  // Upsert registration
  const { error } = await db.from("wallet_registrations").upsert(
    {
      device_library_id: route.deviceLibraryId,
      push_token: pushToken,
      serial_number: route.serialNumber,
      pass_type_id: route.passTypeId,
      registered_at: new Date().toISOString(),
    },
    {
      onConflict: "device_library_id,serial_number,pass_type_id",
    },
  );

  if (error) {
    console.error("[wallet_web_service] Register error:", error.message);
    return new Response("Internal Server Error", { status: 500 });
  }

  // 201 = newly registered, 200 = already existed (Apple expects these)
  return new Response("", { status: 201 });
}

async function handleUnregister(
  db: any,
  route: ParsedRoute,
  req: Request,
): Promise<Response> {
  const authToken = getAuthToken(req);
  if (!authToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ok = await verifyPassAuth(
    db,
    route.serialNumber!,
    route.passTypeId!,
    authToken,
  );
  if (!ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  await db
    .from("wallet_registrations")
    .delete()
    .eq("device_library_id", route.deviceLibraryId)
    .eq("serial_number", route.serialNumber)
    .eq("pass_type_id", route.passTypeId);

  return new Response("", { status: 200 });
}

async function handleListSerials(
  db: any,
  route: ParsedRoute,
): Promise<Response> {
  // Find all serial numbers for this device + pass type that have been updated
  let query = db
    .from("wallet_registrations")
    .select("serial_number")
    .eq("device_library_id", route.deviceLibraryId)
    .eq("pass_type_id", route.passTypeId);

  const { data: registrations, error } = await query;

  if (error || !registrations || registrations.length === 0) {
    return new Response("", { status: 204 }); // No content
  }

  const serialNumbers = registrations.map(
    (r: { serial_number: string }) => r.serial_number,
  );

  // Check which passes have been updated since the tag
  let ticketQuery = db
    .from("tickets")
    .select("wallet_serial_number, wallet_last_pushed_at")
    .in("wallet_serial_number", serialNumbers)
    .eq("wallet_pass_type_id", route.passTypeId);

  if (route.passesUpdatedSince) {
    ticketQuery = ticketQuery.gt(
      "wallet_last_pushed_at",
      route.passesUpdatedSince,
    );
  }

  const { data: tickets } = await ticketQuery;

  if (!tickets || tickets.length === 0) {
    return new Response("", { status: 204 });
  }

  const lastUpdated = new Date().toISOString();
  const serials = tickets.map(
    (t: { wallet_serial_number: string }) => t.wallet_serial_number,
  );

  return new Response(
    JSON.stringify({
      serialNumbers: serials,
      lastUpdated,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

async function handleGetPass(
  db: any,
  route: ParsedRoute,
  req: Request,
): Promise<Response> {
  const authToken = getAuthToken(req);
  if (!authToken) {
    return new Response("Unauthorized", { status: 401 });
  }

  const ok = await verifyPassAuth(
    db,
    route.serialNumber!,
    route.passTypeId!,
    authToken,
  );
  if (!ok) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Fetch the ticket to regenerate the pass
  const { data: ticket } = await db
    .from("tickets")
    .select("id, event_id")
    .eq("wallet_serial_number", route.serialNumber)
    .eq("wallet_pass_type_id", route.passTypeId)
    .single();

  if (!ticket) {
    return new Response("Not Found", { status: 404 });
  }

  // Redirect to the ticket_wallet_apple function to regenerate
  // This is a server-to-server call — Apple fetches the pass when notified
  // For now, we call the generation function internally
  //
  // NOTE: In production, this would regenerate the .pkpass inline.
  // For the initial implementation, we return 304 (not modified) if
  // the pass hasn't been voided, since the pass content hasn't changed.
  const { data: fullTicket } = await db
    .from("tickets")
    .select("wallet_voided_at, status")
    .eq("wallet_serial_number", route.serialNumber)
    .single();

  if (fullTicket?.wallet_voided_at || fullTicket?.status === "refunded" || fullTicket?.status === "void") {
    // Pass has been voided — Apple will remove it from the device
    // Return 410 Gone
    return new Response("Gone", { status: 410 });
  }

  // Return 304 Not Modified — pass content hasn't changed
  // When we implement event update detection, this will regenerate the .pkpass
  return new Response("", { status: 304 });
}

async function handleLog(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    console.log("[wallet_web_service] Device log:", JSON.stringify(body));
  } catch {
    // ignore
  }
  return new Response("", { status: 200 });
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  const route = parseRoute(req);
  const db = supabaseAdmin();

  try {
    switch (route.type) {
      case "register":
        return await handleRegister(db, route, req);
      case "unregister":
        return await handleUnregister(db, route, req);
      case "list_serials":
        return await handleListSerials(db, route);
      case "get_pass":
        return await handleGetPass(db, route, req);
      case "log":
        return await handleLog(req);
      default:
        console.warn(
          "[wallet_web_service] Unknown route:",
          req.method,
          new URL(req.url).pathname,
        );
        return new Response("Not Found", { status: 404 });
    }
  } catch (err) {
    console.error("[wallet_web_service] Unexpected error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
});
