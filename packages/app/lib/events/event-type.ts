import type { EventType } from "../stores/create-event-store";

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  virtual_session: "Virtual Session",
  party: "Party",
  picnic: "Picnic",
  game_night: "Game Night",
  panel: "Panel",
  happy_hour: "Happy Hour",
  wine_down: "Wine Down",
  kickback: "Kickback",
  ball: "Ball",
  kiki: "Kiki",
  pool_party: "Pool Party",
  spoken_word: "Spoken Word",
  open_mic: "Open Mic",
  karaoke: "Karaoke",
  bike_ride: "Bike Ride",
  walk_run: "Walk / Run",
  fitness_training: "Fitness Training",
  yoga: "Yoga",
  meditation: "Meditation",
  bate_session: "Bate Session",
  sex_party: "Sex Party",
  kink_fetish_party: "Kink / Fetish Party",
  training: "Training",
  cooking_class: "Cooking Class",
  mixology: "Mixology",
  dance_class: "Dance Class",
  other: "Other",
};

export const EVENT_TYPE_OPTIONS: { value: EventType; label: string }[] = (
  Object.keys(EVENT_TYPE_LABELS) as EventType[]
).map((value) => ({ value, label: EVENT_TYPE_LABELS[value] }));

export function eventTypeLabel(value: string | null | undefined): string {
  if (!value) return "";
  return EVENT_TYPE_LABELS[value as EventType] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Preserve a legacy category until the organizer explicitly selects a new type. */
export function eventTypeOptions(current?: string | null) {
  return current && !EVENT_TYPE_OPTIONS.some((option) => option.value === current)
    ? [{ value: current, label: eventTypeLabel(current) }, ...EVENT_TYPE_OPTIONS]
    : EVENT_TYPE_OPTIONS;
}

export function eventCardActionLabel(price: number | null | undefined, ended = false): string {
  if (ended) return "Ended";
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? `$${Number(price.toFixed(2))}`
    : "RSVP";
}

/** event_type is authoritative; category is only the older broad taxonomy. */
export function storedEventType(row: { event_type?: unknown; category?: unknown }): string | undefined {
  if (typeof row.event_type === "string" && row.event_type) return row.event_type;
  return typeof row.category === "string" && row.category ? row.category : undefined;
}

/** An explicit legacy selection clears a stale canonical type. */
export function eventTypeUpdate(value: string | null): { event_type: string | null; category?: string | null } {
  if (value && EVENT_TYPE_OPTIONS.some(option => option.value === value)) return { event_type: value };
  return { event_type: null, category: value || null };
}

/** Realtime updates may omit unchanged fields; never downgrade a canonical value. */
export function realtimeEventType(row: { event_type?: unknown; category?: unknown }, current?: string): string | undefined {
  return row.event_type === undefined && row.category === undefined ? current : storedEventType(row);
}
