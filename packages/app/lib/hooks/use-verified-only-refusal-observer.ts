import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setFunctionResponseObserver } from "@dvnt/app/lib/supabase/client";
import {
  GATED_FUNCTIONS,
  readAdmissionRefusal,
  useVerifiedOnlyPromptStore,
} from "@dvnt/app/lib/auth/verified-only-prompt";
import { verifiedAdmissionKeys } from "@dvnt/app/lib/hooks/use-verified-admission";

/**
 * The server-refusal trigger for the verified-only popup. A participation rail
 * that answers with a verified-admission refusal opens the popup and refreshes
 * the verdict, so the next attempt is caught before it leaves the device.
 * Mount once, inside the popup.
 */
export function useVerifiedOnlyRefusalObserver() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const gated = new Set(GATED_FUNCTIONS);
    setFunctionResponseObserver({
      matches: (fnName) => gated.has(fnName),
      observe: (_fnName, response) => {
        response
          .json()
          .then((body: unknown) => {
            const reason = readAdmissionRefusal(body);
            if (!reason) return;
            useVerifiedOnlyPromptStore.getState().show({ reason });
            void queryClient.invalidateQueries({ queryKey: verifiedAdmissionKeys.verdict });
          })
          .catch(() => {
            // Not JSON: not a refusal this popup explains.
          });
      },
    });
    return () => setFunctionResponseObserver(null);
  }, [queryClient]);
}
