/**
 * HMAC-signed QR payload utilities
 *
 * Signs ticket QR payloads with HMAC-SHA256 so scanners can verify
 * authenticity without a network round-trip (fast-path validation).
 *
 * Payload format: base64url(JSON({ tid, eid, nonce, sig }))
 * - tid: ticket ID (uuid)
 * - eid: event ID (integer)
 * - nonce: random 8-byte hex
 * - sig: HMAC-SHA256(tid|eid|nonce, secret) truncated to 16 hex chars
 */

const TICKET_HMAC_SECRET =
  Deno.env.get("TICKET_HMAC_SECRET") || "dvnt-ticket-hmac-default-key";
if (!Deno.env.get("TICKET_HMAC_SECRET")) {
  console.error(
    "[hmac-qr] ⚠️ TICKET_HMAC_SECRET not set — using insecure default key!",
  );
}

function base64url(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlEncode(str: string): string {
  return base64url(new TextEncoder().encode(str));
}

function base64urlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  const decoded = atob(padded + padding);
  return decoded;
}

function generateNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSign(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(TICKET_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  // Truncate to 16 hex chars (64 bits) — sufficient for QR verification
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .substring(0, 16);
}

/**
 * Create a signed QR payload for a ticket.
 * Returns both the raw qr_token (for backward compat) and the signed qr_payload.
 */
export async function createSignedQrPayload(
  ticketId: string,
  eventId: number,
): Promise<{ qrToken: string; qrPayload: string }> {
  const nonce = generateNonce();
  const message = `${ticketId}|${eventId}|${nonce}`;
  const sig = await hmacSign(message);

  const payload = JSON.stringify({
    tid: ticketId,
    eid: eventId,
    nonce,
    sig,
  });

  const qrPayload = base64urlEncode(payload);

  // Also generate a random qr_token for backward compatibility
  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const qrToken = Array.from(tokenBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return { qrToken, qrPayload };
}

/**
 * Verify a signed QR payload.
 * Returns { valid, ticketId, eventId } or { valid: false, reason }.
 */
export async function verifySignedQrPayload(qrPayload: string): Promise<{
  valid: boolean;
  ticketId?: string;
  eventId?: number;
  reason?: string;
}> {
  try {
    const decoded = base64urlDecode(qrPayload);
    const { tid, eid, nonce, sig } = JSON.parse(decoded);

    if (!tid || !eid || !nonce || !sig) {
      return { valid: false, reason: "malformed_payload" };
    }

    const message = `${tid}|${eid}|${nonce}`;
    const expectedSig = await hmacSign(message);

    if (sig !== expectedSig) {
      return { valid: false, reason: "invalid_signature" };
    }

    return { valid: true, ticketId: tid, eventId: eid };
  } catch {
    return { valid: false, reason: "parse_error" };
  }
}
