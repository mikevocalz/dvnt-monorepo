/**
 * Edge Function: ticket_wallet_apple
 *
 * Generates a signed .pkpass file for Apple Wallet and returns it as
 * application/vnd.apple.pkpass so iOS adds it directly.
 *
 * Flow:
 * 1. Verify authenticated user via Better Auth session.
 * 2. Validate user owns the ticket + ticket is active.
 * 3. Generate pass.json with event details, QR barcode, tier styling.
 * 4. Create manifest.json with SHA-1 hashes.
 * 5. Sign manifest with Apple certificates (PKCS#7 / CMS).
 * 6. Package as .pkpass (ZIP) and return binary.
 *
 * Required secrets:
 *   APPLE_PASS_CERT_PEM      — Pass Type ID certificate (PEM)
 *   APPLE_PASS_KEY_PEM       — Private key for the cert (PEM, no passphrase)
 *   APPLE_WWDR_CERT_PEM      — Apple WWDR G4 intermediate cert (PEM)
 *   APPLE_PASS_TYPE_ID       — e.g. "pass.com.dvntapp.ticket"
 *   APPLE_TEAM_ID            — Apple Developer Team ID
 *   WALLET_WEB_SERVICE_URL   — (optional) URL for pass update push notifications
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, CORS_HEADERS } from "../_shared/verify-session.ts";
import forge from "https://esm.sh/node-forge@1.3.1";

// ── Helpers ──────────────────────────────────────────────────────────

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errResp(code: string, message: string, status = 400): Response {
  console.error(`[ticket_wallet_apple] ${code}: ${message}`);
  return jsonResp({ ok: false, error: { code, message } }, status);
}

// ── SHA-1 hash (for manifest.json) ──────────────────────────────────

async function sha1Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Minimal ZIP builder (no dependencies) ───────────────────────────

function buildZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const entries: { name: Uint8Array; data: Uint8Array; offset: number }[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    // Local file header (30 + nameLen + dataLen)
    const header = new Uint8Array(30 + nameBytes.length);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, 0x04034b50, true); // local file header signature
    hv.setUint16(4, 20, true); // version needed
    hv.setUint16(6, 0, true); // flags
    hv.setUint16(8, 0, true); // compression: stored
    hv.setUint16(10, 0, true); // mod time
    hv.setUint16(12, 0, true); // mod date
    // CRC-32
    const crc = crc32(file.data);
    hv.setUint32(14, crc, true);
    hv.setUint32(18, file.data.length, true); // compressed size
    hv.setUint32(22, file.data.length, true); // uncompressed size
    hv.setUint16(26, nameBytes.length, true); // file name length
    hv.setUint16(28, 0, true); // extra field length
    header.set(nameBytes, 30);

    entries.push({ name: nameBytes, data: file.data, offset });
    parts.push(header, file.data);
    offset += header.length + file.data.length;
  }

  // Central directory
  const centralStart = offset;
  for (const entry of entries) {
    const cd = new Uint8Array(46 + entry.name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // central dir signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true); // flags
    cv.setUint16(10, 0, true); // compression: stored
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    const crc = crc32(entry.data);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.name.length, true);
    cv.setUint16(30, 0, true); // extra field length
    cv.setUint16(32, 0, true); // file comment length
    cv.setUint16(34, 0, true); // disk number
    cv.setUint16(36, 0, true); // internal attributes
    cv.setUint32(38, 0, true); // external attributes
    cv.setUint32(42, entry.offset, true); // relative offset
    cd.set(entry.name, 46);
    parts.push(cd);
    offset += cd.length;
  }

  // End of central directory
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // disk with CD
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, offset - centralStart, true); // CD size
  ev.setUint32(16, centralStart, true); // CD offset
  ev.setUint16(20, 0, true); // comment length
  parts.push(eocd);

  // Combine all parts
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) {
    result.set(p, pos);
    pos += p.length;
  }
  return result;
}

// CRC-32 table
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PEM parsing ─────────────────────────────────────────────────────

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ── Tier styling ────────────────────────────────────────────────────

interface TierStyle {
  label: string;
  bgColor: string;
  fgColor: string;
  labelColor: string;
}

const TIER_STYLES: Record<string, TierStyle> = {
  free: {
    label: "FREE",
    bgColor: "rgb(10, 26, 46)",
    fgColor: "rgb(63, 220, 255)",
    labelColor: "rgb(120, 180, 210)",
  },
  ga: {
    label: "GENERAL ADMISSION",
    bgColor: "rgb(10, 20, 40)",
    fgColor: "rgb(52, 162, 223)",
    labelColor: "rgb(100, 160, 200)",
  },
  vip: {
    label: "VIP",
    bgColor: "rgb(26, 10, 46)",
    fgColor: "rgb(200, 160, 255)",
    labelColor: "rgb(170, 130, 220)",
  },
  table: {
    label: "TABLE SERVICE",
    bgColor: "rgb(26, 10, 32)",
    fgColor: "rgb(255, 91, 252)",
    labelColor: "rgb(200, 130, 200)",
  },
};

function inferTier(ticketTypeName: string | null, priceCents: number): string {
  const name = (ticketTypeName || "").toLowerCase();
  if (name.includes("vip")) return "vip";
  if (name.includes("table")) return "table";
  if (priceCents === 0) return "free";
  return "ga";
}

// ── Date formatting ─────────────────────────────────────────────────

function formatPassDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatPassTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "";
  }
}

// ── pass.json builder ───────────────────────────────────────────────

function buildPassJson(opts: {
  passTypeId: string;
  teamId: string;
  serialNumber: string;
  authToken: string;
  webServiceUrl?: string;
  eventTitle: string;
  eventDate: string;
  eventEndDate?: string;
  eventLocation: string;
  tierStyle: TierStyle;
  tierName: string;
  attendeeName: string;
  qrToken: string;
  ticketId: string;
}): string {
  const passData: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: opts.passTypeId,
    teamIdentifier: opts.teamId,
    serialNumber: opts.serialNumber,
    authenticationToken: opts.authToken,
    organizationName: "DVNT",
    description: `${opts.tierName} — ${opts.eventTitle}`,
    logoText: "DVNT",
    foregroundColor: opts.tierStyle.fgColor,
    backgroundColor: opts.tierStyle.bgColor,
    labelColor: opts.tierStyle.labelColor,

    // Barcode (QR code with ticket token)
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: opts.qrToken,
        messageEncoding: "iso-8859-1",
        altText: opts.ticketId.slice(0, 12).toUpperCase(),
      },
    ],

    // Event ticket structure
    eventTicket: {
      headerFields: [
        {
          key: "tier",
          label: "TIER",
          value: opts.tierStyle.label,
        },
      ],
      primaryFields: [
        {
          key: "event",
          label: "EVENT",
          value: opts.eventTitle,
        },
      ],
      secondaryFields: [
        {
          key: "date",
          label: "DATE",
          value: formatPassDate(opts.eventDate),
        },
        {
          key: "time",
          label: "TIME",
          value: formatPassTime(opts.eventDate),
        },
      ],
      auxiliaryFields: [
        {
          key: "location",
          label: "VENUE",
          value: opts.eventLocation || "See event details",
        },
        {
          key: "attendee",
          label: "ATTENDEE",
          value: opts.attendeeName,
        },
      ],
      backFields: [
        {
          key: "ticketId",
          label: "Ticket ID",
          value: opts.ticketId,
        },
        {
          key: "tierInfo",
          label: "Ticket Tier",
          value: opts.tierName,
        },
        {
          key: "support",
          label: "Support",
          value:
            "For help with your ticket, visit dvntapp.live or contact the event organizer.",
        },
      ],
    },

    // Relevance: date and location
    relevantDate: opts.eventDate,
  };

  // Web service for push updates (optional)
  if (opts.webServiceUrl) {
    passData.webServiceURL = opts.webServiceUrl;
  }

  // Expiration: set to end of event + 2 hours
  if (opts.eventEndDate) {
    const expiry = new Date(
      new Date(opts.eventEndDate).getTime() + 2 * 60 * 60 * 1000,
    );
    passData.expirationDate = expiry.toISOString();
  }

  return JSON.stringify(passData);
}

// ── PKCS#7 / CMS Signing (Deno Deploy compatible — no subprocess) ───
// Uses node-forge for pure-JS PKCS#7 detached signature generation.

function signManifest(
  manifestData: Uint8Array,
  certPem: string,
  keyPem: string,
  wwdrPem: string,
): Uint8Array {
  const signerCert = forge.pki.certificateFromPem(certPem);
  const privateKey = forge.pki.privateKeyFromPem(keyPem);
  const wwdrCert = forge.pki.certificateFromPem(wwdrPem);

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(new TextDecoder().decode(manifestData));

  p7.addCertificate(signerCert);
  p7.addCertificate(wwdrCert);

  p7.addSigner({
    key: privateKey,
    certificate: signerCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });

  p7.sign({ detached: false });

  const derBytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
  const result = new Uint8Array(derBytes.length);
  for (let i = 0; i < derBytes.length; i++) {
    result[i] = derBytes.charCodeAt(i);
  }
  return result;
}

// ── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return errResp("method_not_allowed", "Method not allowed", 405);
  }

  try {
    // ── 0. Env vars ──────────────────────────────────────────
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const applePassCert = Deno.env.get("APPLE_PASS_CERT_PEM") || "";
    const applePassKey = Deno.env.get("APPLE_PASS_KEY_PEM") || "";
    const appleWwdr = Deno.env.get("APPLE_WWDR_CERT_PEM") || "";
    const applePassTypeId = Deno.env.get("APPLE_PASS_TYPE_ID") || "";
    const appleTeamId = Deno.env.get("APPLE_TEAM_ID") || "";
    const webServiceUrl = Deno.env.get("WALLET_WEB_SERVICE_URL") || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      return errResp("internal_error", "Server configuration error", 500);
    }

    if (
      !applePassCert ||
      !applePassKey ||
      !appleWwdr ||
      !applePassTypeId ||
      !appleTeamId
    ) {
      return errResp(
        "not_configured",
        "Apple Wallet pass signing is not yet configured. Required secrets: APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, APPLE_WWDR_CERT_PEM, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID",
        501,
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // ── 1. Authenticate ──────────────────────────────────────
    const url = new URL(req.url);
    const queryToken = url.searchParams.get("token")?.trim();
    const authRequest = queryToken
      ? new Request(req, {
          headers: new Headers([
            ...req.headers.entries(),
            ["x-auth-token", queryToken],
          ]),
        })
      : req;
    const authUserId = await verifySession(supabaseAdmin, authRequest);
    if (!authUserId) {
      return errResp("unauthorized", "Invalid or expired session", 401);
    }

    console.log("[ticket_wallet_apple] Auth user:", authUserId);

    // ── 2. Parse input ───────────────────────────────────────
    let ticketId = "";
    let eventId = "";

    if (req.method === "GET") {
      ticketId = url.searchParams.get("ticketId")?.trim() || "";
      eventId = url.searchParams.get("eventId")?.trim() || "";
    } else {
      let body: { ticketId: string; eventId: string };
      try {
        body = await req.json();
      } catch {
        return errResp("validation_error", "Invalid JSON body");
      }
      ticketId = body.ticketId;
      eventId = body.eventId;
    }

    if (!ticketId || !eventId) {
      return errResp("validation_error", "ticketId and eventId are required");
    }

    // ── 3. Verify ticket ownership ───────────────────────────
    // tickets.user_id stores auth_id (Better Auth user.id string)
    const { data: ticketData, error: ticketError } = await supabaseAdmin
      .from("tickets")
      .select(
        "id, event_id, ticket_type_id, user_id, status, qr_token, purchase_amount_cents, " +
          "wallet_serial_number, wallet_auth_token, " +
          "ticket_types(name), " +
          "events(title, start_date, end_date, location, location_name, cover_image_url, host_id)",
      )
      .eq("id", ticketId)
      .single();

    if (ticketError || !ticketData) {
      console.error(
        "[ticket_wallet_apple] Ticket lookup error:",
        ticketError?.message,
      );
      return errResp("not_found", "Ticket not found");
    }

    // Verify ownership: user_id can be auth_id string or integer user ID string
    if (ticketData.user_id !== authUserId) {
      // Fallback: check if user_id is the integer users.id
      const { data: userData } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("auth_id", authUserId)
        .single();
      if (!userData || String(userData.id) !== String(ticketData.user_id)) {
        return errResp("forbidden", "You do not own this ticket", 403);
      }
    }

    // Verify ticket is active
    if (ticketData.status !== "active") {
      return errResp(
        "invalid_ticket",
        `Ticket is ${ticketData.status}, cannot add to wallet`,
      );
    }

    // ── 4. Resolve attendee name ─────────────────────────────
    const { data: attendeeUser } = await supabaseAdmin
      .from("users")
      .select("username, first_name, last_name")
      .eq("auth_id", authUserId)
      .single();

    const attendeeName = attendeeUser
      ? [attendeeUser.first_name, attendeeUser.last_name]
          .filter(Boolean)
          .join(" ") ||
        attendeeUser.username ||
        "Guest"
      : "Guest";

    // ── 5. Generate or reuse serial number + auth token ──────
    let serialNumber = ticketData.wallet_serial_number;
    let authToken = ticketData.wallet_auth_token;

    if (!serialNumber || !authToken) {
      // Generate new serial + auth token
      serialNumber = crypto.randomUUID();
      const tokenBytes = new Uint8Array(32);
      crypto.getRandomValues(tokenBytes);
      authToken = Array.from(tokenBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Persist to tickets table
      await supabaseAdmin
        .from("tickets")
        .update({
          wallet_serial_number: serialNumber,
          wallet_auth_token: authToken,
          wallet_pass_type_id: applePassTypeId,
        })
        .eq("id", ticketId);
    }

    // ── 6. Build pass.json ───────────────────────────────────
    const event = ticketData.events as any;
    const ticketTypeName = (ticketData.ticket_types as any)?.name || null;
    const priceCents = ticketData.purchase_amount_cents || 0;
    const tier = inferTier(ticketTypeName, priceCents);
    const tierStyle = TIER_STYLES[tier] || TIER_STYLES.ga;
    const tierName = ticketTypeName || tierStyle.label;

    const passJsonStr = buildPassJson({
      passTypeId: applePassTypeId,
      teamId: appleTeamId,
      serialNumber,
      authToken,
      webServiceUrl: webServiceUrl || undefined,
      eventTitle: event?.title || "DVNT Event",
      eventDate: event?.start_date || new Date().toISOString(),
      eventEndDate: event?.end_date || undefined,
      eventLocation: event?.location_name || event?.location || "",
      tierStyle,
      tierName,
      attendeeName,
      qrToken: ticketData.qr_token,
      ticketId,
    });

    const passJsonBytes = new TextEncoder().encode(passJsonStr);

    // ── 7. Minimal pass assets (icon is required) ────────────
    // Apple requires icon.png and icon@2x.png at minimum.
    // We generate a simple 29x29 and 58x58 solid-color PNG.
    const iconPng = createMinimalPng(29, 29, [138, 64, 207]); // DVNT purple
    const icon2xPng = createMinimalPng(58, 58, [138, 64, 207]);
    const logoPng = createMinimalPng(160, 50, [138, 64, 207]);
    const logo2xPng = createMinimalPng(320, 100, [138, 64, 207]);

    // ── 8. Build manifest.json ───────────────────────────────
    const passFiles: { name: string; data: Uint8Array }[] = [
      { name: "pass.json", data: passJsonBytes },
      { name: "icon.png", data: iconPng },
      { name: "icon@2x.png", data: icon2xPng },
      { name: "logo.png", data: logoPng },
      { name: "logo@2x.png", data: logo2xPng },
    ];

    const manifestObj: Record<string, string> = {};
    for (const file of passFiles) {
      manifestObj[file.name] = await sha1Hex(file.data);
    }
    const manifestStr = JSON.stringify(manifestObj);
    const manifestBytes = new TextEncoder().encode(manifestStr);

    // ── 9. Sign manifest ─────────────────────────────────────
    const signatureBytes = await signManifest(
      manifestBytes,
      applePassCert,
      applePassKey,
      appleWwdr,
    );

    // ── 10. Package as .pkpass (ZIP) ─────────────────────────
    const zipFiles = [
      ...passFiles,
      { name: "manifest.json", data: manifestBytes },
      { name: "signature", data: signatureBytes },
    ];

    const pkpassData = buildZip(zipFiles);

    console.log(
      `[ticket_wallet_apple] Generated .pkpass for ticket ${ticketId}, ` +
        `serial ${serialNumber}, size ${pkpassData.length} bytes`,
    );

    // ── 11. Update wallet_pass_updated_at timestamp ────────────
    // This allows detecting stale passes after ticket upgrades
    await supabase
      .from("tickets")
      .update({ wallet_pass_updated_at: new Date().toISOString() })
      .eq("id", ticketId);

    // ── 12. Return .pkpass binary ────────────────────────────
    return new Response(pkpassData, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": `${req.method === "GET" ? "inline" : "attachment"}; filename="${ticketId}.pkpass"`,
        "Content-Length": String(pkpassData.length),
        "Cache-Control": "no-store, private, max-age=0",
      },
    });
  } catch (err) {
    console.error("[ticket_wallet_apple] Unexpected error:", err);
    return errResp("internal_error", "An unexpected error occurred", 500);
  }
});

// ── Minimal PNG generator (solid color, no dependencies) ────────────
// Creates a valid PNG with a single solid color. Used for icon/logo
// assets that Apple Wallet requires.

function createMinimalPng(
  width: number,
  height: number,
  rgb: [number, number, number],
): Uint8Array {
  // Build raw pixel data (filter byte + RGB for each row)
  const rawRows: number[] = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(0); // filter: None
    for (let x = 0; x < width; x++) {
      rawRows.push(rgb[0], rgb[1], rgb[2]);
    }
  }
  const rawData = new Uint8Array(rawRows);

  // Deflate with store-only (no compression, valid deflate stream)
  const deflated = deflateStore(rawData);

  // Build PNG chunks
  const ihdr = buildIhdrChunk(width, height);
  const idat = buildIdatChunk(deflated);
  const iend = buildIendChunk();

  // PNG signature + chunks
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const total = signature.length + ihdr.length + idat.length + iend.length;
  const result = new Uint8Array(total);
  let pos = 0;
  result.set(signature, pos);
  pos += signature.length;
  result.set(ihdr, pos);
  pos += ihdr.length;
  result.set(idat, pos);
  pos += idat.length;
  result.set(iend, pos);
  return result;
}

function deflateStore(data: Uint8Array): Uint8Array {
  // Minimal deflate: zlib header (78 01) + stored blocks + adler32
  const maxBlock = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockLen = Math.min(remaining, maxBlock);
    const isFinal = offset + blockLen >= data.length;

    const blockHeader = new Uint8Array(5);
    blockHeader[0] = isFinal ? 0x01 : 0x00;
    blockHeader[1] = blockLen & 0xff;
    blockHeader[2] = (blockLen >> 8) & 0xff;
    blockHeader[3] = ~blockLen & 0xff;
    blockHeader[4] = (~blockLen >> 8) & 0xff;

    blocks.push(blockHeader);
    blocks.push(data.slice(offset, offset + blockLen));
    offset += blockLen;
  }

  // Adler-32
  let a = 1,
    b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = new Uint8Array(4);
  adler[0] = (b >> 8) & 0xff;
  adler[1] = b & 0xff;
  adler[2] = (a >> 8) & 0xff;
  adler[3] = a & 0xff;

  // zlib header
  const zlibHeader = new Uint8Array([0x78, 0x01]);

  const totalLen =
    zlibHeader.length + blocks.reduce((s, b) => s + b.length, 0) + adler.length;
  const result = new Uint8Array(totalLen);
  let pos = 0;
  result.set(zlibHeader, pos);
  pos += zlibHeader.length;
  for (const block of blocks) {
    result.set(block, pos);
    pos += block.length;
  }
  result.set(adler, pos);
  return result;
}

function buildPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false); // big-endian length
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  // CRC over type + data
  const crcData = new Uint8Array(4 + data.length);
  crcData.set(typeBytes, 0);
  crcData.set(data, 4);
  view.setUint32(8 + data.length, pngCrc32(crcData), false);
  return chunk;
}

function buildIhdrChunk(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = 8; // bit depth
  data[9] = 2; // color type: RGB
  data[10] = 0; // compression
  data[11] = 0; // filter
  data[12] = 0; // interlace
  return buildPngChunk("IHDR", data);
}

function buildIdatChunk(deflated: Uint8Array): Uint8Array {
  return buildPngChunk("IDAT", deflated);
}

function buildIendChunk(): Uint8Array {
  return buildPngChunk("IEND", new Uint8Array(0));
}

// PNG uses the same CRC-32 polynomial as ZIP but big-endian output
function pngCrc32(data: Uint8Array): number {
  return crc32(data);
}
