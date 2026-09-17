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
    default:
      return "This QR code is not a valid ticket";
  }
}
