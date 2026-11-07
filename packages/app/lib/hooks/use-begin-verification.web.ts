"use client";
import { useEffect, useRef, useState } from "react";
import {
  useStartVerification,
  useRefreshVerificationStatus,
} from "@dvnt/app/lib/hooks/use-age-verification";
import { onboardingCheckpoint } from "@dvnt/observability/flows";
import { captureAuthContinuation } from "../auth/continuation-guard";
import { roomReturnPath } from "../auth/room-return";

/**
 * Opens the hosted Didit capture, the flow the feed banner starts. Web: a new
 * tab that returns to the current page, then a status re-pull.
 */
export function useBeginVerification() {
  const start = useStartVerification();
  const refresh = useRefreshVerificationStatus();
  const [opened, setOpened] = useState(false);
  const active = useRef(true);
  const guard = useRef<ReturnType<typeof captureAuthContinuation> | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; guard.current?.release(); guard.current = null; };
  }, []);

  const begin = async () => {
    if (guard.current) return;
    const continuation = captureAuthContinuation();
    guard.current = continuation;
    const entryUrl = typeof window !== "undefined" ? window.location.href : undefined;
    const stillCurrent = () => active.current && guard.current === continuation &&
      window.location.href === entryUrl && continuation.isCurrent();
    try {
      const room = entryUrl && roomReturnPath(window.location.pathname);
      const result = await start.mutateAsync({
        returnUrl: room ? window.location.origin + room : entryUrl,
      });
      if (!stillCurrent()) return;
      if (result.url) {
        onboardingCheckpoint("verification.capture_start", { hosted: true });
        setOpened(true);
        window.open(result.url, "_blank", "noopener");
      }
      void refresh();
    } catch {
      // start.isError carries the message for the caller to render.
    } finally {
      continuation.release();
      if (guard.current === continuation) guard.current = null;
    }
  };

  return { begin, start, opened };
}
