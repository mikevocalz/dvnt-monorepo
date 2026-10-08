"use client";
import { useState } from "react";
import {
  useStartVerification,
  useRefreshVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

/**
 * Opens the hosted Didit capture, the flow the feed banner starts. Web: a new
 * tab that returns to the current page, then a status re-pull.
 */
export function useBeginVerification() {
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();
  const [opened, setOpened] = useState(false);

  const begin = async () => {
    try {
      const result = await start.mutateAsync({
        returnUrl: typeof window !== "undefined" ? window.location.href : undefined,
      });
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        setOpened(true);
        window.open(result.url, "_blank", "noopener");
      }
      void refresh();
    } catch {
      // start.isError carries the message for the caller to render.
    }
  };

  return { begin, start, opened };
}
