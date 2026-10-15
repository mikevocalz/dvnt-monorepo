import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getAuthIdFromStore } from "@dvnt/app/lib/auth/identity";
import { prepareEventVideoFile } from "./prepare-event-video.web";

/** Only the newest pick may update a mounted event composer. */
export function useEventFlyerPreparation(scope = "create") {
  const authId = useAuthStore((state) => state.user?.id ?? null);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const [progress, setProgress] = useState<number | null>(null);
  const cancel = useCallback(() => {
    active.current?.abort();
    active.current = null;
    if (mounted.current) setProgress(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    setProgress(null);
    return () => { mounted.current = false; active.current?.abort(); active.current = null; };
  }, [scope, authId]);
  const prepare = useCallback(async (file: File) => {
    active.current?.abort();
    const preparingAuthId = getAuthIdFromStore();
    const controller = new AbortController();
    active.current = controller;
    setProgress(0);
    try {
      const prepared = await prepareEventVideoFile(file, {
        signal: controller.signal,
        onProgress: (value) => {
          if (mounted.current && active.current === controller) setProgress(value);
        },
      });
      return mounted.current && active.current === controller && getAuthIdFromStore() === preparingAuthId ? prepared : null;
    } catch (error) {
      if (!mounted.current || controller.signal.aborted || active.current !== controller) return null;
      throw error;
    } finally {
      if (mounted.current && active.current === controller) {
        active.current = null;
        setProgress(null);
      }
    }
  }, []);
  const isBusy = useCallback(() => active.current !== null, []);
  return { prepare, cancel, progress, isPreparing: progress !== null, isBusy };
}
