/**
 * The "verified users only" popup: what opens it, and what it says.
 *
 * Two triggers share one store. Call sites ask `gateDecision` before a
 * verified-only action, using the same client verdict the feed banner draws
 * from. The supabase fetch observer reads every participation rail's response
 * and opens the popup on a refusal, so a client with a stale verdict still
 * sees it. While `verified_admission_policy.enforce` is false every verdict is
 * `allowed` and no rail refuses, so neither trigger fires.
 *
 * Pure apart from the zustand store, so node:test can reach it.
 */
import { create } from "zustand";
import type { AdmissionReason, AdmissionVerdict } from "./verified-admission.ts";

/** Copy supplied by the product owner. Words, capitals and curly quotes are fixed. */
export const VERIFIED_ONLY_COPY = {
  title: "OOPS:",
  lines: [
    "This is for VERIFIED USERS ONLY.",
    "Post, Host Events, DM & Comment as a Verified User.",
    "“Sneaky Links” and “Spicy” content included for VERIFIED accounts only.",
  ],
  // Button labels were not in the supplied copy; these are placeholders to confirm.
  verify: "Verify now",
  continueVerifying: "Continue verifying",
  dismiss: "Not now",
} as const;

export type VerifiedAction =
  | "post"
  | "host_event"
  | "message"
  | "comment"
  | "sneaky_lynk"
  | "spicy";

/**
 * - `run`: go ahead.
 * - `prompt_then_run`: grace period. The server still admits the action, so
 *   the popup asks once and "Not now" carries on with it.
 * - `prompt`: blocked. The server will refuse, so the action stops here.
 */
export type GateDecision = "run" | "prompt_then_run" | "prompt";

export function gateDecision(
  verdict: AdmissionVerdict | null | undefined,
  graceDismissed: boolean,
): GateDecision {
  // No verdict yet (loading, signed out, unreadable context): stay quiet. The
  // server is the gate and its refusal still opens the popup.
  if (!verdict || verdict.state === "allowed") return "run";
  if (verdict.state === "grace") return graceDismissed ? "run" : "prompt_then_run";
  return "prompt";
}

/** An under-18 document has no retry, so there is nothing to verify again. */
export function canVerify(reason: AdmissionReason | null | undefined): boolean {
  return reason !== "underage";
}

const REFUSAL_REASONS: ReadonlySet<string> = new Set<AdmissionReason>([
  "unauthenticated",
  "verification_required",
  "verification_incomplete",
  "age_evidence_missing",
  "underage",
  "restricted_profile",
]);

/**
 * Edge functions whose refusal opens the popup. Each calls
 * `resolveVerifiedAdmission` and answers a blocked verdict with
 * `admissionRefusal`. video_refresh_token is left out on purpose: it fires on
 * a timer inside a call, and a timer must not reopen a popup the member closed.
 */
export const GATED_FUNCTIONS: readonly string[] = [
  "create-post",
  "update-post",
  "create-story",
  "create-event",
  "send-message",
  "add-comment",
  "video_create_room",
  "video_join_room",
  "lynk-moq-token",
  "lynk-livestream-token",
];

/**
 * Reads a verified-admission refusal out of an edge-function response body.
 * Returns the reason, `verification_required` when the body names the
 * refusal without one, or null for anything else.
 *
 * The rails answer in three shapes (see `admissionRefusal` callers):
 *   { ok:false, error:{ code:"verification_required", message } }            403
 *   { ok:false, error:{ code:"forbidden", message, detail:{ reason } } }     200/403
 *   { ok:false, error:"<message>", code:"verification_required", reason? }   403
 * A bare `forbidden` without an admission reason is a different refusal
 * (not the host, room full) and does not open the popup.
 */
export function readAdmissionRefusal(body: unknown): AdmissionReason | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.ok === true) return null;
  const err = b.error && typeof b.error === "object" ? (b.error as Record<string, unknown>) : null;
  const detail = err?.detail && typeof err.detail === "object"
    ? (err.detail as Record<string, unknown>)
    : null;
  const reasonOf = (value: unknown): AdmissionReason | null =>
    typeof value === "string" && REFUSAL_REASONS.has(value) ? (value as AdmissionReason) : null;

  if (err?.code === "verification_required" || b.code === "verification_required") {
    return reasonOf(err?.reason) ?? reasonOf(detail?.reason) ?? reasonOf(b.reason) ?? "verification_required";
  }
  if (err?.code === "forbidden" || b.code === "forbidden") {
    return reasonOf(detail?.reason) ?? reasonOf(b.reason);
  }
  return null;
}

interface VerifiedOnlyPromptState {
  open: boolean;
  reason: AdmissionReason | null;
  action: VerifiedAction | null;
  /** Grace only: what "Not now" carries on with. */
  onContinue: (() => void) | null;
  show: (input: {
    reason: AdmissionReason | null;
    action?: VerifiedAction | null;
    onContinue?: (() => void) | null;
  }) => void;
  /** Closes without running the pending action. */
  close: () => void;
  /** Closes and runs the pending grace action, if there is one. */
  dismiss: () => void;
}

export const useVerifiedOnlyPromptStore = create<VerifiedOnlyPromptState>((set, get) => ({
  open: false,
  reason: null,
  action: null,
  onContinue: null,
  show: ({ reason, action = null, onContinue = null }) => {
    // One popup at a time. A second refusal while it is up (a retry, two rails
    // in one screen) keeps the first; it says the same thing.
    if (get().open) return;
    set({ open: true, reason, action, onContinue });
  },
  close: () => set({ open: false, reason: null, action: null, onContinue: null }),
  dismiss: () => {
    const next = get().onContinue;
    set({ open: false, reason: null, action: null, onContinue: null });
    next?.();
  },
}));

/**
 * The one helper call sites use. Runs `run` when the member may act, opens the
 * popup otherwise. Returns true when `run` ran now.
 */
export function requireVerified(
  input: {
    verdict: AdmissionVerdict | null | undefined;
    graceDismissed: boolean;
    action: VerifiedAction;
    onGraceDismiss?: () => void;
  },
  run: () => void,
): boolean {
  const decision = gateDecision(input.verdict, input.graceDismissed);
  if (decision === "run") {
    run();
    return true;
  }
  const show = useVerifiedOnlyPromptStore.getState().show;
  show({
    reason: input.verdict?.reason ?? null,
    action: input.action,
    onContinue: decision === "prompt_then_run"
      ? () => {
          input.onGraceDismiss?.();
          run();
        }
      : null,
  });
  return false;
}
