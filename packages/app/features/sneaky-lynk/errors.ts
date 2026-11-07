/**
 * Sneaky Lynk error translation layer.
 *
 * Turns raw backend error codes + messages into a typed, UI-ready
 * classification. The room screen renders a dedicated polished sheet
 * per reason instead of dumping the raw message. Keeps user copy in
 * ONE place so designers can iterate.
 *
 * Backend error contract (from features/sneaky-lynk/api/supabase.ts):
 *   code ∈ "unauthorized" | "forbidden" | "not_found" | "conflict"
 *        | "rate_limited" | "validation_error" | "internal_error"
 *   message: string
 *
 * Known capacity signal: `code: "conflict"`, `message: "Room is full"`
 * (supabase/functions/video_join_room/index.ts:184).
 *
 * Known typed sub-reasons carried on `error.detail.reason`:
 *   "room_full"      — capacity, with { current, max, isHost }
 *   "invite_only"    — private room, no invite
 *   "ROOM_APP_ONLY"  — app-only room rejected a web client before minting a
 *                      peer token (the only ENFORCED capture-protection tier)
 */

export type SneakyLynkErrorReason =
  | "room_full"
  | "room_ended"
  | "rate_limited"
  | "forbidden"
  | "not_found"
  | "unauthorized"
  /** Web client refused a peer token for an app-only room. */
  | "app_only"
  /** Event Lynk the host has not started yet. Not an error: a waiting room. */
  | "waiting_for_host"
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

  // App-only room. Checked first: it's the one reason that isn't about the
  // user or the room's state, and it has a dedicated "get the app" surface
  // rather than a retry. `code` is "forbidden" on the wire (the ErrorCode
  // union is fixed); ROOM_APP_ONLY is the typed sub-reason, same transport
  // the capacity flow uses.
  if (detailReason === "ROOM_APP_ONLY") {
    return {
      reason: "app_only",
      title: "This Lynk is app-only",
      body: "The host made this room app-only, so it can't be opened in a browser. Open it in the DVNT app to join.",
      ctaLabel: null,
      rawMessage: raw,
    };
  }

  // An event room before the host starts it. The room screen shows the
  // waiting room for this instead of an error sheet.
  if (detailReason === "waiting_for_host") {
    return {
      reason: "waiting_for_host",
      title: "Waiting for the host to start",
      body: "You're in the waiting room. You'll join automatically when the host starts.",
      ctaLabel: null,
      rawMessage: raw,
    };
  }

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
        : "Every seat is taken right now. Try again, or choose automatic retries while this screen stays open. A seat is not reserved.",
      ctaLabel: isHost ? "Upgrade" : "Try again",
      rawMessage: raw,
      capacity: { current, max, isHost },
    };
  }

  if (detailReason === "session_expired" || detailReason === "room_ended" || ROOM_ENDED_MATCHERS.some((re) => re.test(raw))) {
    return {
      reason: "room_ended",
      title: "This room has ended",
      body: "This Lynk is no longer open. Ask the host for their next room.",
      ctaLabel: null,
      rawMessage: raw,
    };
  }

  if (code === "not_found" || detailReason === "event_unavailable") {
    return {
      reason: "not_found",
      title: "This Lynk isn't available",
      body: "This link may be out of date, or this room may not be available to your account. Check the link with the host.",
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
    let title = "You can't join this room";
    let body = "Your account doesn't have access to this Lynk right now. Check your account status or contact the host.";
    if (detailReason === "invite_only") {
      title = "This Lynk is invite-only";
      body = "A shared link doesn't grant access to a private room. Ask the host to invite your account.";
    } else if (detailReason === "event_ticket_required") {
      title = "An event ticket is required";
      body = "You need an active admission ticket for this event. A room link or invitation doesn't replace a ticket.";
    } else if (detailReason === "event_invite_required") {
      title = "This event is invite-only";
      body = "Ask the event host to invite your account before joining its Lynk.";
    } else if (detailReason === "member_banned" || /banned from this room/i.test(raw)) {
      title = "Room access removed";
      body = "Your account can't rejoin this Lynk. You can return to Messages to find another room.";
    } else if (["verification_required", "verification_incomplete", "age_evidence_missing"].includes(detailReason ?? "")) {
      title = "Verification needed";
      body = "Complete your account verification before joining this Lynk. An invitation doesn't skip this requirement.";
    } else if (detailReason === "profile_photo_required" || detailReason === "first_post_required") {
      title = "Finish your account setup";
      body = "Complete the required steps in your account before joining this Lynk.";
    } else if (detailReason === "underage") {
      title = "This Lynk is for adults";
      body = "You must meet DVNT's age requirements to join.";
    } else if (["suspended", "paused", "rejected", "standing_unavailable"].includes(detailReason ?? "")) {
      title = "Hosting isn't available";
      body = "Your account can't host or co-host this Lynk right now. Check your creator account status before trying again.";
    }
    return { reason: "forbidden", title, body, ctaLabel: null, rawMessage: raw };
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
