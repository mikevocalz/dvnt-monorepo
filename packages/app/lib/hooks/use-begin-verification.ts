import { useEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { parseIncomingUrl, isLynkRoomLink } from "@dvnt/app/lib/deep-linking/link-engine";
import { lynkRoomAppUrl } from "@dvnt/app/features/sneaky-lynk/room-links";
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
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const lifetime = useRef({ mounted: false, accountEpoch: 0 });
  useEffect(() => {
    lifetime.current.mounted = true;
    const unsubscribe = useAuthStore.subscribe((next, previous) => {
      if ((next.user?.authId || next.user?.id) !== (previous.user?.authId || previous.user?.id) ||
          next.isAuthenticated !== previous.isAuthenticated) lifetime.current.accountEpoch += 1;
    });
    return () => { lifetime.current.mounted = false; unsubscribe(); };
  }, []);

  const begin = async () => {
    const accountKey = useAuthStore.getState().user?.authId || useAuthStore.getState().user?.id;
    const epoch = lifetime.current.accountEpoch;
    const isCurrent = () => lifetime.current.mounted && lifetime.current.accountEpoch === epoch &&
      pathRef.current === pathname &&
      (useAuthStore.getState().user?.authId || useAuthStore.getState().user?.id) === accountKey;
    const room = parseIncomingUrl(pathname);
    const returnUrl = room && isLynkRoomLink(room) ? lynkRoomAppUrl(room.params.id) : null;
    try {
      // The provider's callback returns to this room's prejoin screen. It
      // conveys no verification grant and never restores old media consent.
      const result = await start.mutateAsync({ returnUrl: returnUrl || "dvnt://" });
      if (!isCurrent()) return;
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        setOpened(true);
        await WebBrowser.openBrowserAsync(result.url);
      }
      if (isCurrent()) void refresh();
    } catch {
      // start.isError carries the message for the caller to render.
    }
  };

  return { begin, start, opened };
}
