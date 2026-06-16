/**
 * Sneaky Lynk Room Events Hook
 * Subscribes to realtime room events from Supabase
 */

import { useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import type { RoomEvent, EjectPayload } from "../types";

interface UseRoomEventsParams {
  roomId: string;
  userId: string;
  onMemberJoined?: (event: RoomEvent) => void;
  onMemberLeft?: (event: RoomEvent) => void;
  onEject?: (payload: EjectPayload) => void;
  onRoomEnded?: () => void;
  onRoleChanged?: (event: RoomEvent) => void;
  onHandRaised?: (event: RoomEvent) => void;
}

export function useRoomEvents({
  roomId,
  userId,
  onMemberJoined,
  onMemberLeft,
  onEject,
  onRoomEnded,
  onRoleChanged,
  onHandRaised,
}: UseRoomEventsParams) {
  const subscriptionRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );

  const handleEvent = useCallback(
    (event: RoomEvent) => {
      console.log("[SneakyLynk] Room event:", event.type, event);

      switch (event.type) {
        case "member_joined":
          onMemberJoined?.(event);
          break;

        case "member_left":
          onMemberLeft?.(event);
          break;

        case "eject":
          // Check if current user is the target
          if (event.targetId === userId) {
            const payload = event.payload as unknown as EjectPayload;
            onEject?.(payload);
          }
          break;

        case "room_ended":
          onRoomEnded?.();
          break;

        case "role_changed":
          onRoleChanged?.(event);
          break;

        case "hand_raised":
        case "hand_lowered":
          onHandRaised?.(event);
          break;
      }
    },
    [
      userId,
      onMemberJoined,
      onMemberLeft,
      onEject,
      onRoomEnded,
      onRoleChanged,
      onHandRaised,
    ],
  );

  useEffect(() => {
    if (!roomId) return;

    console.log("[SneakyLynk] Subscribing to room events:", roomId);

    // Subscribe to sneaky_room_events table changes
    const channel = supabase
      .channel(`sneaky-room-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "video_room_events",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const event = payload.new as RoomEvent;
          handleEvent(event);
        },
      )
      .subscribe((status) => {
        console.log("[SneakyLynk] Subscription status:", status);
      });

    subscriptionRef.current = channel;

    return () => {
      console.log("[SneakyLynk] Unsubscribing from room events");
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    };
  }, [roomId, handleEvent]);

  return {
    unsubscribe: () => {
      if (subscriptionRef.current) {
        supabase.removeChannel(subscriptionRef.current);
        subscriptionRef.current = null;
      }
    },
  };
}
