import { invokeEdge } from "./invoke-edge";
import { useCreateEventStore } from "@dvnt/app/lib/stores/create-event-store";

export interface EventDraftSummary {
  id: string;
  title: string;
  source_event_id: number | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface EventDraftRecord extends EventDraftSummary {
  owner_auth_id: string;
  payload: Record<string, unknown>;
}

function snapshotCurrentDraft(): Record<string, unknown> {
  const s = useCreateEventStore.getState();
  return {
    title: s.title,
    description: s.description,
    location: s.location,
    locationData: s.locationData,
    eventImages: s.eventImages,
    tags: s.tags,
    eventDate: s.eventDate,
    endDate: s.endDate,
    ticketPrice: s.ticketPrice,
    maxAttendees: s.maxAttendees,
    youtubeUrl: s.youtubeUrl,
    attachLynkRoom: s.attachLynkRoom,
    ticketingEnabled: s.ticketingEnabled,
    visibility: s.visibility,
    ageRestriction: s.ageRestriction,
    isOnline: s.isOnline,
    dressCode: s.dressCode,
    doorPolicy: s.doorPolicy,
    lineup: s.lineup,
    perks: s.perks,
    ticketTiers: s.ticketTiers,
    addons: s.addons,
    coOrganizers: s.coOrganizers,
    // Guests are intentionally stored for an ordinary private-event draft.
    // duplicate_event never copies them from a source event.
    guests: s.guests,
    promoterTemplates: s.promoterTemplates,
    flyerImage: s.flyerImage,
    flyerMediaType: s.flyerMediaType,
    flyerFallbackImage: s.flyerFallbackImage,
    eventType: s.eventType,
    disclaimers: s.disclaimers,
    isNsfw: s.isNsfw,
    currentStep: s.currentStep,
    scheduleNeedsReview: s.scheduleNeedsReview,
    draftSourceEventId: s.draftSourceEventId,
  };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await invokeEdge<{ ok: boolean; error?: string } & T>(
    "event-drafts",
    body,
  );
  if (error) throw new Error(error.message);
  if (!data?.ok) throw new Error(data?.error || "Event draft request failed");
  return data;
}

export const eventDraftsApi = {
  async list(): Promise<EventDraftSummary[]> {
    const data = await invoke<{ drafts: EventDraftSummary[] }>({ action: "list" });
    return data.drafts ?? [];
  },

  async get(draftId: string): Promise<EventDraftRecord> {
    const data = await invoke<{ draft: EventDraftRecord }>({
      action: "get",
      draftId,
    });
    return data.draft;
  },

  async saveCurrent(): Promise<EventDraftRecord> {
    const s = useCreateEventStore.getState();
    const data = await invoke<{ draft: EventDraftRecord }>({
      action: "save",
      payload: snapshotCurrentDraft(),
      ...(s.serverDraftId
        ? {
            draftId: s.serverDraftId,
            expectedRevision: s.serverDraftRevision,
          }
        : {}),
    });
    useCreateEventStore
      .getState()
      .setServerDraftMeta(data.draft.id, data.draft.revision);
    return data.draft;
  },

  async open(draftId: string): Promise<EventDraftRecord> {
    const draft = await this.get(draftId);
    useCreateEventStore.getState().loadServerDraft(draft.payload as any, {
      id: draft.id,
      revision: draft.revision,
    });
    return draft;
  },

  async delete(draftId: string): Promise<void> {
    await invoke<{ deleted: boolean }>({ action: "delete", draftId });
    const s = useCreateEventStore.getState();
    if (s.serverDraftId === draftId) s.resetDraft();
  },

  async duplicateEvent(eventId: number): Promise<EventDraftRecord> {
    const data = await invoke<{ draft: EventDraftRecord }>({
      action: "duplicate_event",
      eventId,
    });
    useCreateEventStore.getState().loadServerDraft(data.draft.payload as any, {
      id: data.draft.id,
      revision: data.draft.revision,
    });
    return data.draft;
  },
};
