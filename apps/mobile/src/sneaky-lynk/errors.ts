/**
 * Sneaky Lynk error translation layer.
 *
 * Turns raw backend error codes + messages into a typed, UI-ready
 * classification. The room screen renders a dedicated polished sheet
 * per reason instead of dumping the raw message. Keeps user copy in
 * ONE place so designers can iterate.
 *
 * Backend error contract (from src/sneaky-lynk/api/supabase.ts):
 *   code ∈ "unauthorized" | "forbidden" | "not_found" | "conflict"
 *        | "rate_limited" | "validation_error" | "internal_error"
 *   message: string
 *
 * Known capacity signal: `code: "conflict"`, `message: "Room is full"`
 * (supabase/functions/video_join_room/index.ts:184).
 */

export type SneakyLynkErrorReason =
  | "room_full"
  | "room_ended"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "unauthorized"
  | "unknown";

/**
 * Structured detail payload the backend can attach to an error for
 * classifications that need rich UX (currently just capacity). Matches
 * the `error.detail` field from the edge function ApiResponse.
 */
export interface CapacityDetail {
  current: number;
  max: number;
  isHost: boolean;
}

export interface ClassifiedError {
  reason: SneakyLynkErrorReason;
  /** User-facing title — short, tasteful, no jargon. */
  title: string;
  /** User-facing body — explains what happened + what to do. */
  body: string;
  /** Primary-action label (null = close only). */
  ctaLabel: string | null;
  /** The raw message, preserved for debug logs. NEVER shown to users. */
  rawMessage: string;
  /**
   * Capacity-specific metadata when reason === "room_full". Drives the
   * seat count hero + host/viewer branching in RoomFullSheet. Absent
   * for all other reasons.
   */
  capacity?: CapacityDetail;
}

const ROOM_FULL_MATCHERS = [/room is full/i, /at capacity/i, /room full/i];
const ROOM_ENDED_MATCHERS = [
  /no longer open/i,
  /already ended/i,
  /has ended/i,
  /room not found/i,
  /session ended/i,
];

export function classifySneakyLynkError(
  code: string | undefined,
  message: string | undefined,
  detail?: Record<string, unknown>,
): ClassifiedError {
  const raw = message ?? "";

  // Capacity — the reason we're building this layer in the first place.
  // Prefer the structured `detail.reason === "room_full"` signal from
  // newer backends; fall back to message-text matching for older builds
  // that haven't been redeployed yet.
  const detailReason =
    typeof detail?.reason === "string" ? detail.reason : null;
  if (
    detailReason === "room_full" ||
    (code === "conflict" && ROOM_FULL_MATCHERS.some((re) => re.test(raw)))
  ) {
    const current = typeof detail?.current === "number" ? detail.current : 0;
    const max = typeof detail?.max === "number" ? detail.max : 0;
    const isHost = detail?.isHost === true;

    return {
      reason: "room_full",
      title: isHost ? "Your room is full" : "This room is full",
      body: isHost
        ? "You're at the seat limit on your current plan. Upgrade to host larger rooms."
        : "Every seat is taken right now. We'll slide you in the moment one opens up.",
      ctaLabel: isHost ? "Upgrade" : "Notify me",
      rawMessage: raw,
      capacity: { current, max, isHost },
    };
  }

  if (code === "not_found" || ROOM_ENDED_MATCHERS.some((re) => re.test(raw))) {
    return {
      reason: "room_ended",
      title: "This room has ended",
      body: "The host wrapped up. Check the host's profile for their next one.",
      ctaLabel: null,
      rawMessage: raw,
    };
  }

  if (code === "rate_limited") {
    return {
      reason: "rate_limited",
      title: "Too many tries",
      body: "You're trying to join a little too fast. Give it a moment and try again.",
      ctaLabel: "OK",
      rawMessage: raw,
    };
  }

  if (code === "forbidden") {
    return {
      reason: "forbidden",
      title: "You can't join this room",
      body: "Only invited participants can join. Reach out to the host for access.",
      ctaLabel: null,
      rawMessage: raw,
    };
  }

  if (code === "unauthorized") {
    return {
      reason: "unauthorized",
      title: "Sign in to join",
      body: "You need to be signed in to join this Lynk.",
      ctaLabel: "Sign in",
      rawMessage: raw,
    };
  }

  // Fallback — NEVER show the raw backend string.
  return {
    reason: "unknown",
    title: "Something went wrong",
    body: "We couldn't join this room right now. Try again in a moment.",
    ctaLabel: "Try again",
    rawMessage: raw,
  };
}
