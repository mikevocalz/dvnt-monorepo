/**
 * App-facing Live Activity control (shared, native-free).
 *
 * Maps a live event + host broadcast into a SAFE Live Activity state
 * (buildEventLiveActivityState neutralizes spicy events) and forwards to a
 * platform backend. The native backend (expo-widgets createLiveActivity) is
 * registered by the mobile app at boot — see apps/mobile/widgets/backend.ts.
 * No-op on web / Android / before registration.
 */
import { buildEventLiveActivityState } from "./dataset";
import type { EventLiveActivityState, SafetyFlags } from "./types";

export interface LiveActivityBackend {
  isSupported(): boolean | Promise<boolean>;
  start(state: EventLiveActivityState): void | Promise<void>;
  update(state: EventLiveActivityState): void | Promise<void>;
  end(eventId?: string): void | Promise<void>;
}

let backend: LiveActivityBackend | null = null;

export function registerLiveActivityBackend(next: LiveActivityBackend | null): void {
  backend = next;
}

export interface EventLiveActivityInput {
  eventId: string;
  ticketId?: string | null;
  eventName?: string | null;
  startAt: string;
  venueName?: string | null;
  broadcast?: string | null;
  tier?: string | null;
  tierName?: string | null;
  dominantColor?: string | null;
  /** Visibility/NSFW flags of the event — drives neutral suppression. */
  safety?: SafetyFlags;
}

export async function areLiveActivitiesSupported(): Promise<boolean> {
  try {
    return backend ? await backend.isSupported() : false;
  } catch {
    return false;
  }
}

/** Start (or, if the backend upserts, refresh) the event Live Activity. */
export async function startEventLiveActivity(
  input: EventLiveActivityInput,
): Promise<EventLiveActivityState> {
  const state = buildEventLiveActivityState(input);
  try {
    await backend?.start(state);
  } catch (err) {
    console.warn("[widgets] LA start failed:", err);
  }
  return state;
}

/** Update the running Live Activity (e.g. a new host broadcast / countdown). */
export async function updateEventLiveActivity(
  input: EventLiveActivityInput,
): Promise<EventLiveActivityState> {
  const state = buildEventLiveActivityState(input);
  try {
    await backend?.update(state);
  } catch (err) {
    console.warn("[widgets] LA update failed:", err);
  }
  return state;
}

export async function endEventLiveActivity(eventId?: string): Promise<void> {
  try {
    await backend?.end(eventId);
  } catch (err) {
    console.warn("[widgets] LA end failed:", err);
  }
}
