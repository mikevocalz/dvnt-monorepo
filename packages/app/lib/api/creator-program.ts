import { invokeEdge } from "@dvnt/app/lib/api/invoke-edge";

export type CreatorProgramStatus =
  | "invited"
  | "applied"
  | "under_review"
  | "approved"
  | "paused"
  | "rejected"
  | "suspended";

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
