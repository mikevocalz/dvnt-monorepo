import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";
import { CALL_HUMAN_CAPACITY } from "../constants/call-capacity";

export type CreatorProgramStatus =
  | "invited"
  | "applied"
  | "under_review"
  | "approved"
  | "paused"
  | "rejected"
  | "suspended";

/**
 * Seats a creator session can be scheduled for. A creator Lynk is the same
 * twelve-seat room everything else uses, so the cap is CALL_HUMAN_CAPACITY
 * rather than a second number — the edge function bounds `capacity` by the
 * identical constant in supabase/functions/_shared/call-capacity.ts.
 */
export const CREATOR_SESSION_MAX_CAPACITY = CALL_HUMAN_CAPACITY;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeEdge<any>("creator-program", body);
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || "Creator program request failed");
  return data as T;
}

export const creatorProgramApi = {
  apply: () => call({ action: "apply" }),
  dashboard: () => call({ action: "dashboard" }),
  acceptTerms: () => call({ action: "accept_terms" }),
  /**
   * `capacity` is seats in the Lynk room, so it is bounded by
   * CREATOR_SESSION_MAX_CAPACITY — not by anything a picker invents. The edge
   * function refuses anything above it; this re-export is here so a UI reads
   * the cap off the constant instead of guessing.
   *
   * `eventId` must be an event the caller organizes. The server verifies that
   * against event_co_organizers before it writes, and refuses otherwise.
   */
  schedule: (input: {
    title: string;
    startsAt: string;
    endsAt?: string | null;
    capacity?: number | null;
    eventId?: number | null;
  }) =>
    call({
      action: "schedule",
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt ?? null,
      capacity: input.capacity ?? null,
      event_id: input.eventId ?? null,
    }),
  cancel: (sessionId: string) => call({ action: "cancel", session_id: sessionId }),
  reportIncident: (input: { sessionId: string; kind: string; reportedUserId?: string; notes?: string }) =>
    call({
      action: "incident",
      session_id: input.sessionId,
      kind: input.kind,
      reported_user_id: input.reportedUserId,
      notes: input.notes,
    }),
};
