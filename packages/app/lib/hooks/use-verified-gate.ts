import { useCallback } from "react";
import {
  useVerifiedAdmission,
  useAdmissionPromptStore,
} from "@dvnt/app/lib/hooks/use-verified-admission";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  requireVerified,
  type VerifiedAction,
} from "@dvnt/app/lib/auth/verified-only-prompt";

/**
 * `guard(action, run)` runs `run` for a member the server will admit and opens
 * the verified-only popup for one it will not. Grace members see the popup
 * once per launch, and "Not now" carries on with the action, because the
 * server still admits them until the deadline. Returns true when `run` ran.
 */
export function useVerifiedGate() {
  const authId = useAuthStore((s) => s.user?.authId);
  const { data: verdict } = useVerifiedAdmission();
  const dismissed = useAdmissionPromptStore((s) => s.dismissed);
  const dismiss = useAdmissionPromptStore((s) => s.dismiss);

  return useCallback(
    (action: VerifiedAction, run: () => void): boolean =>
      requireVerified(
        {
          verdict,
          graceDismissed: !!authId && dismissed.includes(authId),
          action,
          onGraceDismiss: authId ? () => dismiss(authId) : undefined,
        },
        run,
      ),
    [authId, verdict, dismissed, dismiss],
  );
}
