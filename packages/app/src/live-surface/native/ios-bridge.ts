/**
 * Live Activity bridge — now backed by the stable `expo-widgets`
 * `createLiveActivity` (SDK 56), replacing the removed hand-written
 * ActivityKit Swift module. Exposes the same surface the live-surface hook
 * already uses (`updateLiveActivity` / `endLiveActivity` /
 * `areLiveActivitiesEnabled`), mapping the Live Surface payload to a SAFE Live
 * Activity state.
 *
 * SAFETY: the payload carries no nsfw flag, so we resolve the event and
 * neutralize the Live Activity (no spicy name/art) unless the event is
 * confirmed safe — defaulting to neutral when it can't be resolved.
 */
import { Platform } from "react-native";
import {
  areLiveActivitiesSupported,
  endEventLiveActivity,
  startEventLiveActivity,
  type EventLiveActivityInput,
} from "@dvnt/app/lib/widgets";
import { eventsApi } from "@dvnt/app/lib/api/events";

import type { LiveSurfacePayload } from "../types";

const isIOS = Platform.OS === "ios";

export async function areLiveActivitiesEnabled(): Promise<boolean> {
  if (!isIOS) return false;
  return areLiveActivitiesSupported();
}

async function payloadToInput(
  payload: LiveSurfacePayload,
): Promise<EventLiveActivityInput | null> {
  const t1 = payload?.tile1;
  if (!t1?.eventId || !t1.startAt) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ev: any = null;
  try {
    ev = await eventsApi.getEventById(String(t1.eventId));
  } catch {
    ev = null;
  }
  // Default to UNSAFE (neutral Lock Screen) when the event can't be resolved.
  const safety = {
    nsfw: ev ? !!ev.nsfw : true,
    visibility: (ev ? (ev.visibility ?? "public") : "unknown") as string,
  };

  // Optional host broadcast (Prompt 7B) if the payload surfaces one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const broadcast = (payload as any)?.broadcast?.message ?? null;

  return {
    eventId: String(t1.eventId),
    eventName: t1.title,
    startAt: t1.startAt,
    venueName: t1.venueName,
    broadcast,
    dominantColor: ev?.dominantColor ?? null,
    safety,
  };
}

/** Start or refresh the event Live Activity from a Live Surface payload. */
export function updateLiveActivity(payload: LiveSurfacePayload): void {
  if (!isIOS) return;
  void (async () => {
    try {
      const input = await payloadToInput(payload);
      if (input) await startEventLiveActivity(input);
    } catch (e) {
      console.warn("[LiveSurface] updateLiveActivity failed:", e);
    }
  })();
}

/** End all active DVNT Live Activities. */
export function endLiveActivity(): void {
  if (!isIOS) return;
  void endEventLiveActivity().catch((e) =>
    console.warn("[LiveSurface] endLiveActivity failed:", e),
  );
}
