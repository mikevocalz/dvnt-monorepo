/**
 * Offline Scanner Utilities
 *
 * Allows organizers to download an HMAC-hashed allowlist of tickets
 * for offline validation at the door. Uses MMKV for secure local storage.
 *
 * Algorithm:
 *   1. Server generates event_secret per event
 *   2. For each ticket: HMAC_SHA256(event_secret, qr_token) → stored hash
 *   3. Scanner offline: hash scanned token with event_secret, check membership
 *   4. Mark locally as scanned (Set) to prevent same-device repeats
 *   5. Reconcile when online: upload scanned tokens batch
 *
 * Cross-device offline duplicates cannot be fully prevented without connectivity.
 */

import { Platform } from "react-native";
import { createMMKV } from "react-native-mmkv";

let storage: ReturnType<typeof createMMKV> | null = null;
try {
  if (Platform.OS !== "web") {
    storage = createMMKV({ id: "offline-scanner" });
  }
} catch {
  console.error("[OfflineScanner] Failed to initialize MMKV");
}

// ── HMAC SHA-256 (Web Crypto API, available in React Native Hermes) ──

async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Storage keys ────────────────────────────────────────────────────

function allowlistKey(eventId: string) {
  return `allowlist_${eventId}`;
}
function secretKey(eventId: string) {
  return `secret_${eventId}`;
}
function scannedKey(eventId: string) {
  return `scanned_${eventId}`;
}

// ── Download allowlist from server ──────────────────────────────────

export interface AllowlistEntry {
  hash: string;
  ticketId: string;
}

export async function downloadAllowlist(
  eventId: string,
  eventSecret: string,
  tickets: Array<{ id: string; qr_token: string }>,
): Promise<number> {
  const entries: AllowlistEntry[] = [];

  for (const ticket of tickets) {
    const hash = await hmacSha256(eventSecret, ticket.qr_token);
    entries.push({ hash, ticketId: ticket.id });
  }

  // Store allowlist and secret
  if (!storage) throw new Error("MMKV not available");
  storage.set(allowlistKey(eventId), JSON.stringify(entries));
  storage.set(secretKey(eventId), eventSecret);
  storage.set(scannedKey(eventId), JSON.stringify([]));

  console.log(
    `[OfflineScanner] Downloaded ${entries.length} tickets for event ${eventId}`,
  );
  return entries.length;
}

// ── Validate a QR token offline ─────────────────────────────────────

export interface OfflineScanResult {
  valid: boolean;
  reason: "valid" | "invalid" | "already_scanned" | "no_allowlist";
  ticketId?: string;
}

export async function validateOffline(
  eventId: string,
  qrToken: string,
): Promise<OfflineScanResult> {
  if (!storage) return { valid: false, reason: "no_allowlist" };
  const secret = storage.getString(secretKey(eventId));
  const allowlistJson = storage.getString(allowlistKey(eventId));

  if (!secret || !allowlistJson) {
    return { valid: false, reason: "no_allowlist" };
  }

  // Hash the scanned token
  const hash = await hmacSha256(secret, qrToken);

  // Check allowlist
  const allowlist: AllowlistEntry[] = JSON.parse(allowlistJson);
  const entry = allowlist.find((e) => e.hash === hash);

  if (!entry) {
    return { valid: false, reason: "invalid" };
  }

  // Check if already scanned locally
  const scannedJson = storage?.getString(scannedKey(eventId)) || "[]";
  const scannedSet: string[] = JSON.parse(scannedJson);

  if (scannedSet.includes(hash)) {
    return {
      valid: false,
      reason: "already_scanned",
      ticketId: entry.ticketId,
    };
  }

  // Mark as scanned locally
  scannedSet.push(hash);
  storage!.set(scannedKey(eventId), JSON.stringify(scannedSet));

  return { valid: true, reason: "valid", ticketId: entry.ticketId };
}

// ── Get scanned tokens for reconciliation ───────────────────────────

export function getScannedTokens(eventId: string): string[] {
  const json = storage?.getString(scannedKey(eventId)) || "[]";
  return JSON.parse(json);
}

// ── Clear offline data for an event ─────────────────────────────────

export function clearOfflineData(eventId: string) {
  storage?.remove(allowlistKey(eventId));
  storage?.remove(secretKey(eventId));
  storage?.remove(scannedKey(eventId));
}

// ── Check if offline mode is available for an event ─────────────────

export function hasOfflineAllowlist(eventId: string): boolean {
  return storage?.contains(allowlistKey(eventId)) ?? false;
}

export function getOfflineTicketCount(eventId: string): number {
  const json = storage?.getString(allowlistKey(eventId));
  if (!json) return 0;
  try {
    return JSON.parse(json).length;
  } catch {
    return 0;
  }
}
