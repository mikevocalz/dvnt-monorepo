import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { createRoomLifecycleWatcher } from "../room-lifecycle";
import { createRoomLifecycleSource } from "../room-lifecycle-source";

export interface UseRoomLifecycleOptions {
  roomId?: string | null;
  userId?: string | null;
  /** Set only after video_join_room has admitted this room and user. */
  enabled: boolean;
  /** Stop all local publishing/subscribing, release capture, and exit the room. */
  onEnded: () => void;
  /** MoQ reconnect is another opportunity to recover a missed room-row event. */
  connectionStatus?: string;
}

/**
 * Shared web/native authoritative room-end observer. Unlike video_room_events,
 * this subscription/read does not depend on the caller remaining an active
 * member after video_end_room changes every membership to `left`.
 */
export function useRoomLifecycle({
  roomId,
  userId,
  enabled,
  onEnded,
  connectionStatus,
}: UseRoomLifecycleOptions) {
  const scope = JSON.stringify([roomId, userId, enabled]);
  const callbackRef = useRef({ scope, onEnded });
  callbackRef.current = { scope, onEnded };
  const watcherRef = useRef<ReturnType<typeof createRoomLifecycleWatcher> | null>(null);

  useEffect(() => {
    if (!enabled || !roomId || !userId) return;
    const watcher = createRoomLifecycleWatcher({
      roomId,
      userId,
      enabled,
      onEnded: () => {
        // A previous room/account may resolve between render and effect cleanup.
        // Never apply that old room's end to a replacement admission.
        if (callbackRef.current.scope === scope) callbackRef.current.onEnded();
      },
      onError: (error) => console.warn("[video] room lifecycle check failed:", error),
      source: {
        ...createRoomLifecycleSource({
          roomId,
          userId,
          client: supabase,
          createChannel: freshChannel,
        }),
        subscribeResume(check) {
          const appState = AppState.addEventListener("change", (state) => {
            if (state === "active") check();
          });
          const onVisibility = () => {
            if (document.visibilityState === "visible") check();
          };
          if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
            window.addEventListener("online", check);
            window.addEventListener("focus", check);
          }
          if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", onVisibility);
          }
          return () => {
            appState.remove();
            if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
              window.removeEventListener("online", check);
              window.removeEventListener("focus", check);
            }
            if (typeof document !== "undefined") {
              document.removeEventListener("visibilitychange", onVisibility);
            }
          };
        },
      },
    });
    watcherRef.current = watcher;
    return () => {
      watcher.stop();
      if (watcherRef.current === watcher) watcherRef.current = null;
    };
  }, [enabled, roomId, userId, scope]);

  const checkNow = useCallback(() => watcherRef.current?.checkNow(), []);
  const notifyEnded = useCallback(() => watcherRef.current?.notifyEnded(), []);

  useEffect(() => {
    if (enabled && connectionStatus === "connected") checkNow();
  }, [enabled, connectionStatus, checkNow]);

  return { checkNow, notifyEnded };
}
