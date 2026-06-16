import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import type { SneakyUser } from "../types";

const REACTION_TTL_MS = 2400;

interface ReactionBroadcastPayload {
  id: string;
  roomId: string;
  userId: string;
  senderLabel: string;
  emoji: string;
  createdAt: string;
}

export interface RoomReaction extends ReactionBroadcastPayload {
  isOwn: boolean;
}

interface UseRoomReactionsOptions {
  roomId: string;
  currentUser: SneakyUser;
}

export function useRoomReactions({
  roomId,
  currentUser,
}: UseRoomReactionsOptions) {
  const [reactions, setReactions] = useState<RoomReaction[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const removeReaction = useCallback((id: string) => {
    setReactions((prev) => prev.filter((reaction) => reaction.id !== id));

    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const enqueueReaction = useCallback(
    (reaction: RoomReaction) => {
      setReactions((prev) => [...prev.slice(-5), reaction]);

      if (timersRef.current[reaction.id]) {
        clearTimeout(timersRef.current[reaction.id]);
      }

      timersRef.current[reaction.id] = setTimeout(() => {
        removeReaction(reaction.id);
      }, REACTION_TTL_MS);
    },
    [removeReaction],
  );

  const ensureChannel = useCallback(() => {
    if (!roomId || !currentUser.id) return null;
    if (channelRef.current) return channelRef.current;
    const channel = supabase.channel(`sneaky-room-reactions:${roomId}`);
    channel
      .on("broadcast", { event: "reaction" }, (payload) => {
        const reaction = payload.payload as ReactionBroadcastPayload;
        if (!reaction?.id || reaction.userId === currentUser.id) return;
        enqueueReaction({ ...reaction, isOwn: false });
      })
      .subscribe();

    channelRef.current = channel;
    return channel;
  }, [roomId, currentUser.id, enqueueReaction]);

  useEffect(() => {
    const channel = ensureChannel();
    if (!channel) return;

    return () => {
      Object.values(timersRef.current).forEach((timer) => clearTimeout(timer));
      timersRef.current = {};

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [ensureChannel]);

  const sendReaction = useCallback(
    async (emoji: string) => {
      if (!emoji || !roomId || !currentUser.id) return;

      const payload: ReactionBroadcastPayload = {
        id: `${currentUser.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        roomId,
        userId: currentUser.id,
        senderLabel:
          currentUser.anonLabel ||
          currentUser.displayName ||
          currentUser.username ||
          "You",
        emoji,
        createdAt: new Date().toISOString(),
      };

      enqueueReaction({ ...payload, isOwn: true });

      const channel = ensureChannel();
      if (!channel) return;

      await channel.send({
        type: "broadcast",
        event: "reaction",
        payload,
      });
    },
    [currentUser, roomId, enqueueReaction, ensureChannel],
  );

  return {
    reactions,
    sendReaction,
  };
}
