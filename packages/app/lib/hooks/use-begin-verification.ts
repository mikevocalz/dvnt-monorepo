import { useState } from "react";
import * as WebBrowser from "expo-web-browser";
import {
  useStartVerification,
  useRefreshVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

/**
 * Opens the hosted Didit capture, the flow the feed banner starts. Native:
 * in-app browser, then a status re-pull on return. `opened` flips once the
 * capture page has been shown, so the label can say "Continue verifying".
 */
export function useBeginVerification() {
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();
  const [opened, setOpened] = useState(false);

  const begin = async () => {
    try {
      const result = await start.mutateAsync({ returnUrl: "dvnt://" });
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        setOpened(true);
        await WebBrowser.openBrowserAsync(result.url);
      }
      void refresh();
    } catch {
      // start.isError carries the message for the caller to render.
    }
  };

  return { begin, start, opened };
}
