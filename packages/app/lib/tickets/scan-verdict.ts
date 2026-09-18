/**
 * Door scan verdicts — "the ticket is bad" vs "we could not ask".
 *
 * Only the server may call a ticket invalid. A dead session, a 403, a 429, a
 * 5xx or a dropped connection says nothing about the ticket in front of the
 * scanner, and rendering any of them as the red "Invalid Ticket" card turns a
 * paying guest away (or teaches door staff to ignore the scanner). These are
 * reported as SCAN FAILURES and rendered as "Scan Error" with what to do next.
 *
 * Pure: no platform imports, so web, native and tests share one mapping.
 */

/** The scan never produced a verdict about the ticket. */
export type ScanFailureReason =
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error";

const FAILURE_REASONS: readonly ScanFailureReason[] = [
  "unauthorized",
  "forbidden",
  "rate_limited",
  "server_error",
];

/**
 * Offline, and the token is not in the downloaded list.
 *
 * This is a NO-VERDICT, not a rejection, and the distinction is the difference
 * between admitting someone and turning them away. The list is active tickets
 * as of the last refresh (180s at best, and frozen for as long as the door is
 * offline), so a ticket sold at the door is absent from it through no fault of
 * the holder. Rendering that red told a paying guest their ticket was fake on
 * the strength of a stale cache — a refusal the server never made.
 */
export const OFFLINE_UNVERIFIED = "offline_unverified";

/** Map an HTTP status from the `ticket-scan` edge fn to a failure reason. */
export function scanFailureReasonForStatus(status: number): ScanFailureReason {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  return "server_error";
}

/**
 * True when `reason` means "no verdict" rather than "bad ticket".
 * `network_error` is the legacy catch-all older clients/queued results carry.
 */
export function isScanFailure(reason: string | null | undefined): boolean {
  return (
    reason === OFFLINE_UNVERIFIED ||
    reason === "network_error" ||
    (FAILURE_REASONS as readonly string[]).includes(reason ?? "")
  );
}

/** What door staff should read for every non-admitting outcome. */
export function scanVerdictMessage(reason: string | null | undefined): string {
  switch (reason) {
    // ── verdicts about the ticket (server said so) ──
    case "already_scanned":
      return "This ticket was already scanned";
    case "refunded":
      return "This ticket has been refunded";
    case "wrong_event":
      return "This ticket is for a different event";
    case "voided":
      return "This ticket was voided";
    case "transfer_pending":
      return "Ticket is mid-transfer — the new holder's ticket is the valid one";
    // ── no verdict: tell staff what to do, never that the ticket is fake ──
    case "unauthorized":
      return "Your session expired. Sign out and back in, then rescan — the ticket was NOT checked.";
    case "forbidden":
      return "This account is not on the event's door staff. Ask the host to add you (and accept the invite).";
    case "rate_limited":
      return "Scanning too fast — wait a few seconds and rescan. The ticket was NOT checked.";
    case "server_error":
    case "network_error":
      return "Couldn't reach the server — rescan. The ticket was NOT checked.";
    case "offline_unverified":
      // NOT "this is not a ticket". The downloaded list is active tickets as
      // of the last refresh, so anything sold since — at the door, or while
      // this phone was offline — is legitimately missing from it.
      return "This code isn't in the downloaded list, which may be out of date. Get signal and rescan, or look them up by name.";
    default:
      return "This QR code is not a valid ticket";
  }
}

/**
 * The first line of the verdict card.
 *
 * Splitting this out of the screen is not tidiness — the title was the one
 * part of the card that did NOT distinguish the two outcomes it matters most
 * to tell apart. "Scan Error" was shown both for a ticket the server rejected
 * (red) and for a scan that never got an answer (amber), so the only thing
 * separating "turn this person away" from "try again" was the background
 * colour. At a dark door, through a cracked screen, that is no distinction at
 * all, and 05-a11y.md forbids relying on it.
 *
 * Three rules hold here:
 *   • the verdict word comes first, so a screen reader announces the outcome
 *     before the detail
 *   • red titles name the actual rejection, because already-scanned, refunded
 *     and wrong-event send the guest to three different places
 *   • every no-verdict title opens with "Not checked in", so the ticket's
 *     state is the first fact and never a footnote
 */
export function scanVerdictTitle(
  outcome: "success" | "rejected" | "no_verdict",
  reason: string | null | undefined,
  kind?: "ticket" | "addon",
): string {
  if (outcome === "success") {
    return kind === "addon" ? "Add-on redeemed" : "Admitted — let them in";
  }

  if (outcome === "no_verdict") {
    switch (reason) {
      case "unauthorized":
        return "Not checked in — you were signed out";
      case "forbidden":
        return "Not checked in — you're not on door staff";
      case "rate_limited":
        return "Not checked in — scanning too fast";
      case "network_error":
        return "Not checked in — no signal";
      case "offline_unverified":
        return "Not checked in — can't verify offline";
      default:
        return "Not checked in — the server didn't answer";
    }
  }

  switch (reason) {
    case "already_scanned":
      return "Already scanned — don't let them in yet";
    case "refunded":
      return "Refunded — don't let them in";
    case "voided":
      return "Ticket cancelled — don't let them in";
    case "wrong_event":
      return "Wrong event — don't let them in";
    case "transfer_pending":
      return "Transferred — this ticket isn't the valid one";
    default:
      return "Not a ticket for tonight";
  }
}
