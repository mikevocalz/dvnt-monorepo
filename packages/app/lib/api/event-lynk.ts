/**
 * Event Sneaky Lynk waiting room: thin wrappers over the event-lynk-room edge
 * function. The function decides everything; these only carry the answer.
 */
import { invokeEdge } from "./invoke-edge";

export type EventLynkState = "scheduled" | "ready" | "live" | "ended" | "cancelled";

export interface EventLynkWaiter {
  userId: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  joinedAt: string;
}

export interface EventLynkWaitResult {
  state: EventLynkState;
  /** True once the host started: call video_join_room now. */
  admitted: boolean;
  startsAt?: string | null;
}

export interface EventLynkHostView {
  state: EventLynkState;
  count: number;
  waiting: EventLynkWaiter[];
}

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await invokeEdge<T & { ok?: boolean; error?: string }>(
    "event-lynk-room",
    body,
  );
  if (error || !data || (data as any).ok === false) {
    throw new Error(error?.message || (data as any)?.error || fallback);
  }
  return data;
}

export const eventLynkApi = {
  /** Heartbeat from the waiting room. Records presence until the host starts. */
  wait: (roomId: string) =>
    call<EventLynkWaitResult>({ action: "wait", room_id: roomId }, "Couldn't reach the waiting room"),
  /** Host only: lifecycle state and who is waiting. */
  list: (eventId: number) =>
    call<EventLynkHostView>({ action: "list", event_id: eventId }, "Couldn't load the waiting room"),
  /** Host only: open the room. Idempotent. */
  start: (eventId: number) =>
    call<{ state: EventLynkState; started: boolean; admitted: number }>(
      { action: "start", event_id: eventId },
      "Couldn't start the Lynk",
    ),
};
