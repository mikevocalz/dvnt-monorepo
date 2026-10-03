/**
 * Pure validation for a scheduled creator Lynk session.
 *
 * Lives here, not inline in the edge function, because three of the four
 * fields were wrong in ways only a test can pin down:
 *
 *   • `capacity` was bounded at 1..5000 beside a hard twelve-seat room. The
 *     bound now comes from CALL_HUMAN_CAPACITY, the constant every other layer
 *     already defers to (call-create-schema.ts does the same `.max()`), so the
 *     number cannot drift from the room it describes.
 *   • `event_id` went through `Number.isInteger(Number(x))`, which accepts
 *     `"0"`, `"-5"`, `true` and `1e21`. It is now `Number.isSafeInteger` plus a
 *     positive bound; ownership is checked by the caller against
 *     `_shared/event-access.ts`, because that needs the database.
 *   • `ends_at` was compared only when parseable, so unparseable junk passed
 *     through as null instead of being refused.
 */
import { CALL_HUMAN_CAPACITY } from "./call-capacity.ts";

export const CREATOR_SESSION_TITLE_MAX = 120;

/**
 * Digits only, no leading zero, no sign, no exponent — the same shape
 * `call-create-schema.ts` requires of a participant id. `Number("1e1")` is a
 * perfectly safe integer 10, so a bare `Number()` would take exponent
 * notation as a seat count; this refuses it before the numeric checks run.
 */
const POSITIVE_DIGITS = /^[1-9]\d*$/;

function positiveFromString(value: string): number {
  const trimmed = value.trim();
  return POSITIVE_DIGITS.test(trimmed) ? Number(trimmed) : NaN;
}

export interface CreatorSessionInput {
  title: string;
  startsAtIso: string;
  endsAtIso: string | null;
  capacity: number | null;
  eventId: number | null;
}

export type CreatorSessionParse =
  | { ok: true; value: CreatorSessionInput }
  | { ok: false; error: string };

/** Trimmed and bounded, never truncated into something the host did not type. */
function cleanTitle(value: unknown): string {
  return typeof value === "string"
    ? value.trim().slice(0, CREATOR_SESSION_TITLE_MAX)
    : "";
}

/**
 * A positive, safe, whole event id — or null when the field is absent.
 * `undefined` means "no event" the same way `null` does; anything else that is
 * not a clean positive integer is a refusal, not a silent null, so a client
 * sending `"0"` hears about it instead of quietly publishing an unlinked
 * session.
 */
export function parseEventId(
  value: unknown,
): { ok: true; eventId: number | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, eventId: null };
  // `true` numbers to 1 and `""` numbers to 0; neither is an event reference.
  if (typeof value !== "number" && typeof value !== "string") {
    return { ok: false, error: "event_id must be a positive event reference" };
  }
  const eventId = typeof value === "number" ? value : positiveFromString(value);
  if (!Number.isSafeInteger(eventId) || eventId <= 0) {
    return { ok: false, error: "event_id must be a positive event reference" };
  }
  return { ok: true, eventId };
}

export function parseCreatorSessionInput(
  body: Record<string, unknown>,
  now = Date.now(),
): CreatorSessionParse {
  const title = cleanTitle(body.title);
  const startsAt = typeof body.starts_at === "string"
    ? Date.parse(body.starts_at)
    : NaN;
  if (!title || !Number.isFinite(startsAt) || startsAt <= now) {
    return { ok: false, error: "A future starts_at and title are required" };
  }

  let endsAtIso: string | null = null;
  if (body.ends_at != null && body.ends_at !== "") {
    const endsAt = typeof body.ends_at === "string"
      ? Date.parse(body.ends_at)
      : NaN;
    if (!Number.isFinite(endsAt)) {
      return { ok: false, error: "ends_at must be a valid timestamp" };
    }
    if (endsAt <= startsAt) {
      return { ok: false, error: "ends_at must be after starts_at" };
    }
    endsAtIso = new Date(endsAt).toISOString();
  }

  let capacity: number | null = null;
  if (body.capacity != null && body.capacity !== "") {
    const tooLarge = `capacity must be 1-${CALL_HUMAN_CAPACITY}`;
    // Same reason parseEventId narrows first: `true` numbers to 1 and `[5]`
    // numbers to 5, so a loose `Number()` would accept both as seat counts.
    if (typeof body.capacity !== "number" && typeof body.capacity !== "string") {
      return { ok: false, error: tooLarge };
    }
    capacity = typeof body.capacity === "number"
      ? body.capacity
      : positiveFromString(body.capacity);
    if (
      !Number.isSafeInteger(capacity) || capacity <= 0 ||
      capacity > CALL_HUMAN_CAPACITY
    ) {
      return { ok: false, error: tooLarge };
    }
  }

  const event = parseEventId(body.event_id);
  if (!event.ok) return { ok: false, error: event.error };

  return {
    ok: true,
    value: {
      title,
      startsAtIso: new Date(startsAt).toISOString(),
      endsAtIso,
      capacity,
      eventId: event.eventId,
    },
  };
}
