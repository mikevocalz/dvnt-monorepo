/**
 * Transactional guest-ticket SMS delivery.
 *
 * Provider-specific details stay in this module so ticket issuance never depends
 * on Twilio semantics. A ticket can exist even when SMS delivery fails.
 *
 * The consent gate is HERE, in the same function that talks to the provider,
 * and it fails closed. Keeping it in the caller meant a read failure was
 * indistinguishable from "no opt-out on file" and the message went out anyway,
 * and it meant every future send path started non-compliant by default.
 */
const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || "";
const TWILIO_AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || "";
const TWILIO_FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER") || "";
const PUBLIC_SITE_URL = (Deno.env.get("PUBLIC_SITE_URL") || "https://dvntapp.live").replace(/\/$/, "");

export type SmsDeliveryState = "queued" | "sent" | "delivered" | "failed" | "suppressed";

export function normalizePhoneE164(raw: unknown, defaultCountry = "US"): string | null {
  if (typeof raw !== "string") return null;
  const input = raw.trim();
  if (!input) return null;
  if (/^\+[1-9]\d{7,14}$/.test(input)) return input;
  const digits = input.replace(/\D/g, "");
  if (defaultCountry === "US") {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  }
  return null;
}

export function ticketClaimUrl(token: string): string {
  return `${PUBLIC_SITE_URL}/public/tickets/guest/${encodeURIComponent(token)}`;
}

export interface SmsSendResult {
  ok: boolean;
  providerMessageId?: string;
  state: SmsDeliveryState;
  retryable?: boolean;
  error?: string;
}

function basicAuth(accountSid: string, authToken: string): string {
  return btoa(`${accountSid}:${authToken}`);
}

/** The service-role client. Typed `any` to match the convention every other
 *  module in _shared uses (see event-access.ts), because a narrower structural
 *  type does not accept supabase-js's overloaded rpc signature. */
// deno-lint-ignore no-explicit-any
type SupabaseLike = any;

export async function sendTicketSms(params: {
  /**
   * Service-role client. Required, not optional: the consent gate below is the
   * only thing standing between a comp batch and an unlawful send, and a
   * caller that could omit the client could omit the gate. This is why the
   * check lives here rather than in bulk-comp-tickets, where it previously sat
   * and where every new send path would have had to remember it.
   */
  supabase: SupabaseLike;
  to: string;
  eventTitle: string;
  hostLabel?: string | null;
  lookupToken: string;
  /** Who supplied the number. Recorded as the organizer's consent attestation. */
  actorId?: string | null;
  eventId?: number | null;
  ticketId?: string | null;
  /** Edge function name, recorded on the consent row. */
  source?: string;
}): Promise<SmsSendResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { ok: false, state: "failed", retryable: false, error: "SMS provider not configured" };
  }
  const to = normalizePhoneE164(params.to);
  if (!to) return { ok: false, state: "failed", retryable: false, error: "Invalid phone number" };

  // ── Consent gate and consent record, one atomic call ──────────────────
  // record_sms_transactional_send checks the opt state under a row lock,
  // writes the default state for a number we have never contacted so nothing
  // is left implicit, and appends the purpose row the branch doc requires.
  //
  // Fail closed. The previous caller-side check read `const { data: pref }`
  // and never looked at `error`, so any read failure left pref === null and
  // the send went out regardless. An unavailable consent state is a retryable
  // delivery failure, never a send.
  const { data: consent, error: consentError } = await params.supabase.rpc(
    "record_sms_transactional_send",
    {
      p_phone_e164: to,
      p_source: params.source || "ticket-sms-delivery",
      p_actor_id: params.actorId ?? null,
      p_event_id: params.eventId ?? null,
      p_ticket_id: params.ticketId ?? null,
    },
  );
  if (consentError || !consent) {
    // No phone number in the log line: a PG error's DETAIL can quote the
    // offending value.
    console.error(
      "[ticket-sms-delivery] consent check failed:",
      consentError?.code || "empty response",
    );
    return {
      ok: false,
      state: "failed",
      retryable: true,
      error: "Consent state unavailable",
    };
  }
  if (consent.ok !== true) {
    return {
      ok: false,
      state: "suppressed",
      retryable: false,
      error: consent.error || "Recipient opted out",
    };
  }

  const host = (params.hostLabel || "A DVNT host").trim().slice(0, 60);
  const title = (params.eventTitle || "an event").trim().slice(0, 90);
  const body = `${host} comped you a ticket to ${title}. Claim it securely: ${ticketClaimUrl(params.lookupToken)} Reply STOP to opt out, HELP for help.`;

  try {
    const form = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      return {
        ok: false,
        state: "failed",
        retryable,
        error: String(payload?.message || `SMS provider returned ${res.status}`).slice(0, 300),
      };
    }
    return {
      ok: true,
      providerMessageId: String(payload?.sid || ""),
      state: payload?.status === "sent" ? "sent" : "queued",
    };
  } catch (error) {
    return {
      ok: false,
      state: "failed",
      retryable: true,
      error: String((error as Error)?.message || error).slice(0, 300),
    };
  }
}
