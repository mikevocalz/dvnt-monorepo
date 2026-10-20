import { useEffect, useMemo, useRef, useState } from "react";
import { storiesApi } from "../api/stories";
import { useAuthStore } from "../stores/auth-store";
import type { StoryViewerSegment } from "../stores/story-viewer-store";
import { SHARED_STORY_BACKDROP } from "../stories/shared-source";

/** No retained grant: each opening, segment activation and account epoch reads RLS. */
export function useSharedStoryPlayback(
  segment: StoryViewerSegment | undefined,
  open: boolean,
  visitKey: string,
) {
  const viewerId = useAuthStore((state) => state.user?.id);
  const authId = useAuthStore((state) => state.user?.authId);
  const epoch = useRef(0);
  const [identityRevision, setIdentityRevision] = useState(0);
  useEffect(
    () =>
      useAuthStore.subscribe((state, previous) => {
        if (
          state.user?.id !== previous.user?.id ||
          state.user?.authId !== previous.user?.authId
        ) {
          epoch.current++;
          setIdentityRevision(epoch.current);
        }
      }),
    [],
  );
  const request = useMemo(
    () => ({ segment, viewerId, epoch: epoch.current }),
    [segment, viewerId, authId, identityRevision, open, visitKey],
  );
  const activeRequest = useRef(request);
  activeRequest.current = request;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const requestIsCurrent = () =>
    mounted.current &&
    open &&
    activeRequest.current === request &&
    epoch.current === request.epoch &&
    useAuthStore.getState().user?.id === viewerId;
  const authorized = useRef<typeof request | null>(null);
  const isCurrent = () =>
    requestIsCurrent() &&
    (!segment?.sharedSource || authorized.current === request);
  const [result, setResult] = useState<{
    request: typeof request;
    segment: StoryViewerSegment | null;
  } | null>(null);

  const revoke = () => {
    if (!requestIsCurrent()) return;
    authorized.current = null;
    setResult({ request, segment: null });
  };

  useEffect(() => {
    if (!open || !segment?.sharedSource || !segment.id || !viewerId) return;
    let cancelled = false;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !cancelled && requestIsCurrent();
    void storiesApi
      .getSharedStoryForPlayback(
        segment.id,
        segment.sharedSource,
        viewerId,
        current,
      )
      .then((fresh) => {
        if (!current()) return;
        if (fresh && fresh.expiresAt <= Date.now()) fresh = null;
        authorized.current = fresh ? request : null;
        if (fresh)
          expiryTimer = setTimeout(
            () => {
              if (!current()) return;
              authorized.current = null;
              setResult({ request, segment: null });
            },
            Math.max(0, fresh.expiresAt - Date.now()),
          );
        setResult({
          request,
          segment: fresh
            ? {
                ...segment,
                type: fresh.mediaType,
                url: fresh.mediaUrl || SHARED_STORY_BACKDROP,
                sharedSource: fresh.sharedSource,
                isSourceCard: !fresh.mediaUrl,
                storyOverlays: [],
                animatedGifOverlays: [],
              }
            : null,
        });
      })
      .catch(() => {
        if (current()) {
          authorized.current = null;
          setResult({ request, segment: null });
        }
      });
    return () => {
      cancelled = true;
      clearTimeout(expiryTimer);
    };
  }, [request, open, segment, viewerId]);

  if (!segment?.sharedSource)
    return { status: "ready" as const, segment, isCurrent, revoke };
  if (!open || !viewerId || !segment.id)
    return {
      status: "unavailable" as const,
      segment: undefined,
      isCurrent,
      revoke,
    };
  if (result?.request !== request || request.epoch !== epoch.current)
    return {
      status: "checking" as const,
      segment: undefined,
      isCurrent,
      revoke,
    };
  return result.segment
    ? { status: "ready" as const, segment: result.segment, isCurrent, revoke }
    : { status: "unavailable" as const, segment: undefined, isCurrent, revoke };
}
