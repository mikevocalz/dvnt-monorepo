/**
 * Guest ticket lookup API (WS-7 guest re-request).
 *
 * Backed by supabase/functions/guest-ticket-lookup. Email-only delivery:
 * the server RE-SENDS the guest ticket email(s) and never returns ticket
 * data — the response is identical whether or not tickets exist, so the
 * UI should always show the same "check your inbox" confirmation.
 */

import { invokeEdge } from "./invoke-edge";

export interface GuestLookupResult {
  ok: boolean;
  /** Uniform, user-showable confirmation copy from the server. */
  message: string;
}

interface GuestLookupResponse {
  ok?: boolean;
  message?: string;
  error?: { code?: string; message?: string };
}

export const guestLookupApi = {
  /**
   * Ask the server to re-send guest ticket emails for `email`
   * (optionally scoped to one event). Throws on validation/rate-limit
   * errors; resolves with uniform confirmation copy otherwise.
   */
  async resendTickets(args: {
    email: string;
    eventId?: string | number | null;
  }): Promise<GuestLookupResult> {
    const { data, error } = await invokeEdge<GuestLookupResponse>(
      "guest-ticket-lookup",
      {
        email: args.email.trim(),
        event_id: args.eventId ?? null,
      },
      { requireAuth: false },
    );
    if (error) throw new Error(error.message);
    if (!data || data.ok !== true) {
      throw new Error(data?.error?.message || "Could not process the request");
    }
    return {
      ok: true,
      message:
        data.message ||
        "If guest tickets exist for that email, we've re-sent them.",
    };
  },
};
