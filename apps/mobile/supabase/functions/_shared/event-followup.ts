/**
 * Pure helpers for the organizer post-event follow-up email.
 *
 * No imports and no env reads, so the Deno tests in event-followup.test.ts
 * can drive every rule directly. The edge functions own all I/O.
 */

export interface FollowupContent {
  subject: string | null;
  message: string;
  cta_label: string;
  delay_minutes: number;
}

export interface ExistingCampaign extends FollowupContent {
  enabled: boolean;
  campaign_version: number;
  status: string;
  scheduled_at: string | null;
}

export interface FollowupPlan {
  /** False when the save changes nothing; the caller skips the write. */
  write: boolean;
  row: Record<string, unknown>;
  versionBumped: boolean;
}

/** Normalise a settings POST body into the fields that end up in the email. */
export function normaliseFollowupInput(body: any): FollowupContent & { enabled: boolean } {
  const delayRaw = Number(body?.delay_minutes ?? 600);
  const delay = Number.isFinite(delayRaw) ? Math.round(delayRaw) : 600;
  return {
    enabled: body?.enabled === true,
    subject: typeof body?.subject === "string" ? body.subject.trim().slice(0, 120) || null : null,
    message: typeof body?.message === "string" ? body.message.trim().slice(0, 3000) : "",
    cta_label:
      typeof body?.cta_label === "string"
        ? body.cta_label.trim().slice(0, 60) || "Leave a review"
        : "Leave a review",
    delay_minutes: Math.max(0, Math.min(10080, delay)),
  };
}

export function followupContentChanged(a: FollowupContent, b: FollowupContent): boolean {
  return (
    (a.subject ?? null) !== (b.subject ?? null) ||
    (a.message ?? "") !== (b.message ?? "") ||
    (a.cta_label ?? "") !== (b.cta_label ?? "") ||
    Number(a.delay_minutes) !== Number(b.delay_minutes)
  );
}

/**
 * Decide what a settings save writes.
 *
 * campaign_version only moves when the mailed content or the send time
 * changes. A no-op save writes nothing, and a toggle of `enabled` alone keeps
 * the version. Even when the version does move, the worker skips anyone who
 * already received a follow-up for this event (see recipientsToEnqueue), so a
 * bump never re-mails an attendee.
 */
export function planFollowupSave(
  existing: ExistingCampaign | null,
  input: FollowupContent & { enabled: boolean },
  scheduledAt: string,
  authId: string,
  nowIso: string,
): FollowupPlan {
  const contentChanged = !existing || followupContentChanged(existing, input);
  const version = existing
    ? existing.campaign_version + (contentChanged ? 1 : 0)
    : 1;

  if (existing && !contentChanged && existing.enabled === input.enabled) {
    // Nothing the organizer controls changed. Keep the row as it is,
    // including a "sent" status, so the worker does not pick it up again.
    // The one exception is a campaign still waiting to go out whose event
    // moved: follow the new end time without touching the version.
    if (existing.status === "scheduled" && existing.enabled &&
      Date.parse(existing.scheduled_at ?? "") !== Date.parse(scheduledAt)) {
      return {
        write: true,
        row: { scheduled_at: scheduledAt, updated_by: authId, updated_at: nowIso },
        versionBumped: false,
      };
    }
    return { write: false, row: {}, versionBumped: false };
  }

  const row: Record<string, unknown> = {
    enabled: input.enabled,
    subject: input.subject,
    message: input.message,
    cta_label: input.cta_label,
    delay_minutes: input.delay_minutes,
    campaign_version: version,
    scheduled_at: input.enabled ? scheduledAt : null,
    status: input.enabled ? "scheduled" : "disabled",
    updated_by: authId,
    updated_at: nowIso,
  };
  return { write: true, row, versionBumped: !!existing && contentChanged };
}

export interface TicketLike {
  id: string;
  user_id: string | null;
  guest_email: string | null;
}

/**
 * One row per address, minus anyone already mailed a follow-up for this event
 * under any campaign version. Resending to past recipients is not a thing a
 * settings save can trigger.
 */
export function recipientsToEnqueue(
  tickets: TicketLike[],
  emailByAuth: Map<string, string>,
  alreadyMailed: Set<string>,
): Map<string, { ticketId: string; userId: string | null }> {
  const out = new Map<string, { ticketId: string; userId: string | null }>();
  for (const t of tickets) {
    const email = String(t.guest_email || emailByAuth.get(String(t.user_id)) || "")
      .trim()
      .toLowerCase();
    if (!email || out.has(email) || alreadyMailed.has(email)) continue;
    out.set(email, { ticketId: t.id, userId: t.user_id || null });
  }
  return out;
}

/**
 * Per-send gate. A failed suppression lookup never falls through to a send:
 * the row is retried on a later run instead.
 */
export function suppressionDecision(check: {
  lookupFailed: boolean;
  addressUnsubscribed: boolean;
  memberOptedOut: boolean;
}): "send" | "suppress" | "retry" {
  if (check.lookupFailed) return "retry";
  if (check.addressUnsubscribed || check.memberOptedOut) return "suppress";
  return "send";
}

// ── Unsubscribe tokens ───────────────────────────────────────────────────
// The token carries the address and an HMAC over it. Verifying needs no
// database read, so the endpoint cannot be used to learn whether an address
// exists anywhere.

const TOKEN_CONTEXT = "event-followup-unsubscribe:v1:";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function signUnsubscribeToken(secret: string, email: string): Promise<string> {
  if (!secret) throw new Error("unsubscribe secret missing");
  const normalised = email.trim().toLowerCase();
  const payload = b64url(new TextEncoder().encode(normalised));
  const sig = b64url(await hmac(secret, TOKEN_CONTEXT + normalised));
  return `${payload}.${sig}`;
}

/** Returns the address the token was issued for, or null for any bad token. */
export async function verifyUnsubscribeToken(secret: string, token: string): Promise<string | null> {
  if (!secret || typeof token !== "string" || token.length > 1024) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const payload = fromB64url(parts[0]);
  const sig = fromB64url(parts[1]);
  if (!payload || !sig || !payload.length) return null;
  const email = new TextDecoder().decode(payload);
  if (email !== email.trim().toLowerCase() || !email.includes("@")) return null;
  const expected = await hmac(secret, TOKEN_CONTEXT + email);
  return timingSafeEqual(sig, expected) ? email : null;
}

// ── Email body ───────────────────────────────────────────────────────────

export function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c
  );
}

export function buildFollowupEmail(args: {
  eventTitle: string | null;
  subject: string | null;
  message: string | null;
  ctaLabel: string | null;
  reviewUrl: string;
  unsubscribeUrl: string;
}): { subject: string; html: string; headers: Record<string, string> } {
  const title = args.eventTitle || "your event";
  const message = escapeHtml(args.message || `Thanks for coming to ${title}.`);
  const html =
    `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto">` +
    `<h2>${escapeHtml(args.eventTitle || "Thanks for coming")}</h2>` +
    `<p style="white-space:pre-wrap">${message}</p>` +
    `<p><a href="${escapeHtml(args.reviewUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#111;color:#fff;text-decoration:none">${escapeHtml(args.ctaLabel || "Leave a review")}</a></p>` +
    `<p style="font-size:12px;color:#666">You got this because you had a ticket to ${escapeHtml(title)}. ` +
    `<a href="${escapeHtml(args.unsubscribeUrl)}" style="color:#666">Unsubscribe from event follow-up emails</a>.</p>` +
    `</div>`;
  return {
    subject: args.subject || `How was ${title}?`,
    html,
    headers: {
      "List-Unsubscribe": `<${args.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
