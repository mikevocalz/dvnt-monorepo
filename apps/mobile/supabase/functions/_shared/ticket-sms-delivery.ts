/**
 * Transactional guest-ticket SMS delivery.
 *
 * Provider-specific details stay in this module so ticket issuance never depends
 * on Twilio semantics. A ticket can exist even when SMS delivery fails.
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

export async function sendTicketSms(params: {
  to: string;
  eventTitle: string;
  hostLabel?: string | null;
  lookupToken: string;
}): Promise<SmsSendResult> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
    return { ok: false, state: "failed", retryable: false, error: "SMS provider not configured" };
  }
  const to = normalizePhoneE164(params.to);
  if (!to) return { ok: false, state: "failed", retryable: false, error: "Invalid phone number" };

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
