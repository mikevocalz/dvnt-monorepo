/**
 * Claim a phone comp from its /ticket/claim/<token> link.
 *
 * Uses invokeEdge rather than the privileged helper because the refusal text
 * matters here: "expired", "someone else claimed it" and "verify your ID"
 * each tell the recipient something different to do, and the privileged
 * helper collapses every non-2xx into one generic error.
 */
import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

export interface CompClaimSuccess {
  ticket_id: string;
  event_id: number;
  already_claimed: boolean;
}

export type CompClaimOutcome =
  | { ok: true; data: CompClaimSuccess }
  | { ok: false; status: number | null; message: string };

export async function claimCompTicket(token: string): Promise<CompClaimOutcome> {
  const { data, error } = await invokeEdge<{ ok: boolean; data?: CompClaimSuccess; error?: string }>(
    "claim-comp-ticket",
    { token },
  );
  if (error) {
    return { ok: false, status: error.status ?? null, message: error.message };
  }
  if (!data?.ok || !data.data) {
    return { ok: false, status: null, message: data?.error || "Could not claim this ticket. Try again." };
  }
  return { ok: true, data: data.data };
}
