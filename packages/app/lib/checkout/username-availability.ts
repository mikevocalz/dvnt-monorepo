/**
 * Live username availability for the checkout sheets.
 *
 * Format problems answer at once, from the same rules the server applies.
 * A well-formed name waits for typing to pause, then asks the server. An
 * answer for a name the buyer has since edited away is dropped, so a slow
 * response can never mark the current name as free. No React, no network:
 * the caller supplies `check`, which keeps this testable under node --test.
 */
import { checkUsername } from "./profile-fields.ts";

export type UsernameStatus = "idle" | "invalid" | "checking" | "available" | "taken" | "error";

export interface UsernameState {
  status: UsernameStatus;
  /** Shown under the field. Null when there is nothing to say. */
  message: string | null;
}

export type UsernameCheck = (username: string) => Promise<{ available: boolean; message?: string | null }>;

export const IDLE: UsernameState = { status: "idle", message: null };

export function createUsernameAvailability(opts: {
  check: UsernameCheck;
  onChange: (state: UsernameState) => void;
  delayMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}) {
  const delayMs = opts.delayMs ?? 350;
  const schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let latest = "";

  function input(raw: string) {
    if (timer !== null) cancel(timer);
    timer = null;
    const parsed = checkUsername(raw);
    latest = parsed.ok ? parsed.value : "";
    if (!raw.trim()) return opts.onChange(IDLE);
    if (!parsed.ok) {
      return opts.onChange(
        parsed.code === "reserved_username"
          ? { status: "taken", message: "That username is taken." }
          : { status: "invalid", message: parsed.message },
      );
    }
    const name = parsed.value;
    opts.onChange({ status: "checking", message: null });
    timer = schedule(async () => {
      timer = null;
      try {
        const result = await opts.check(name);
        if (latest !== name) return;
        opts.onChange(
          result.available
            ? { status: "available", message: `@${name} is yours if you check out now.` }
            : { status: "taken", message: result.message || "That username is taken." },
        );
      } catch {
        if (latest !== name) return;
        // Not a refusal: checkout still works, and the server picks the
        // nearest free name if this one went in the meantime.
        opts.onChange({ status: "error", message: "Couldn't check that name right now." });
      }
    }, delayMs);
  }

  return {
    input,
    dispose() {
      if (timer !== null) cancel(timer);
      timer = null;
      latest = "";
    },
  };
}
