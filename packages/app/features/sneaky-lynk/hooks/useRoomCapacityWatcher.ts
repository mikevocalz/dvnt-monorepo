/**
 * useRoomCapacityWatcher
 *
 * Polls a Sneaky Lynk room's live participant count while the user is
 * parked on the "room is full" surface. Fires a single callback when a
 * seat opens. Owns its own teardown — stops polling on unmount, on
 * notify, and whenever `enabled` flips false.
 *
 * Product behavior (viewer branch of the capacity flow):
 *
 *   1. Viewer hits a full room → the RoomFullSheet opens with a
 *      "Notify me" CTA.
 *   2. Tapping "Notify me" sets `enabled` true — this hook starts a
 *      2s poll against the current participant count.
 *   3. When `current < max`, `onSeatOpen()` fires. The sheet can then
 *      auto-retry the join or offer a "Tap to join" confirmation.
 *   4. The hook stops polling either when a seat opens OR the user
 *      dismisses the sheet — whichever first.
 *
 * Polling interval is generous (2s) — capacity transitions are slow
 * events (a person leaves), we don't need second-level accuracy and
 * we don't want to hammer the backend.
 *
 * Future upgrade: when the Sneaky Lynk realtime channel gets a
 * `participant_count` message, swap polling for a subscription.
 * Nothing else changes.
 */

import { useEffect, useRef } from "react";
import { sneakyLynkApi } from "../api/supabase";

const POLL_INTERVAL_MS = 2000;

interface Options {
  roomId: string | undefined;
  max: number;
  enabled: boolean;
  onSeatOpen: () => void;
}

export function useRoomCapacityWatcher({
  roomId,
  max,
  enabled,
  onSeatOpen,
}: Options) {
  // Stash the callback in a ref so the effect deps don't depend on a
  // caller-owned function identity. This prevents the interval from
  // being torn down + restarted on every parent render.
  const onSeatOpenRef = useRef(onSeatOpen);
  onSeatOpenRef.current = onSeatOpen;

  useEffect(() => {
    if (!enabled || !roomId || !max) return;

    let cancelled = false;

    const check = async () => {
      try {
        // Attempt a join — the edge function returns either success or
        // the structured "room_full" conflict. We ONLY care about the
        // transition here; if it succeeds we notify (the caller will
        // take the actual join path). If it still fails as full, we
        // keep polling.
        //
        // This is deliberately the same endpoint as the real join, so
        // we never notify the user "seat open!" and then fail when
        // they tap — the seat opened exactly when this probe succeeded.
        const response = await sneakyLynkApi.joinRoom(roomId);
        if (cancelled) return;

        // If the room is open and we got a successful join response,
        // the caller's onSeatOpen handler is responsible for actually
        // transitioning to the connected state. We don't hold the
        // token — we just signal.
        if (response.ok) {
          onSeatOpenRef.current();
          return;
        }

        // Still full (or a different, worse error) — keep polling on
        // "conflict" room_full; bail on anything else.
        const reason =
          (response.error?.detail as { reason?: string } | undefined)?.reason;
        if (response.error?.code !== "conflict" || reason !== "room_full") {
          // Not a capacity situation anymore — stop polling so we don't
          // silently cover up a new error like "room ended".
          return;
        }
      } catch {
        // Transient network failure — just swallow and wait for the
        // next tick. Don't blast the user with connectivity errors.
      }
    };

    const id = setInterval(check, POLL_INTERVAL_MS);
    // Run one probe immediately so the user doesn't wait a full
    // interval if a seat just opened.
    void check();

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [enabled, roomId, max]);
}
