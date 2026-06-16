/**
 * Typing Indicator Hook
 *
 * Uses Supabase Realtime broadcast channels for cross-device typing events.
 * - Debounced typing events using TanStack Pacer
 * - Auto-clear after timeout (like FB/Instagram)
 * - Supabase Realtime broadcast for real-time updates
 * - Memory-efficient with cleanup on unmount
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAuthStore } from "@/lib/stores/auth-store";
import { supabase } from "@/lib/supabase/client";
import { Debouncer } from "@tanstack/pacer";
import type { RealtimeChannel } from "@supabase/supabase-js";

const TYPING_TIMEOUT = 3000; // Clear typing status after 3s of no typing
const DEBOUNCE_DELAY = 300; // Debounce typing events by 300ms

interface TypingIndicatorOptions {
  conversationId: string;
  enabled?: boolean;
}

interface TypingIndicatorReturn {
  isTyping: boolean;
  typingUsers: string[];
  setTyping: (isTyping: boolean) => void;
  handleInputChange: (text: string) => void;
}

/**
 * Hook to manage typing indicator state via Supabase Realtime broadcast
 */
export function useTypingIndicator({
  conversationId,
  enabled = true,
}: TypingIndicatorOptions): TypingIndicatorReturn {
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const user = useAuthStore((s) => s.user);

  const typingDebouncerRef = useRef<Debouncer<() => void> | null>(null);
  const remoteDebouncersRef = useRef<Record<string, Debouncer<() => void>>>({});
  const lastTextRef = useRef<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Broadcast typing status via Supabase Realtime
  const broadcastTyping = useCallback(
    (typing: boolean) => {
      if (!user?.id || !enabled || !channelRef.current) return;

      channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: user.id, username: user.username, typing },
      });

      setIsTyping(typing);
    },
    [user?.id, user?.username, enabled],
  );

  // Set typing status with auto-clear
  const setTypingState = useCallback(
    (typing: boolean) => {
      if (typingDebouncerRef.current) {
        typingDebouncerRef.current.cancel();
      }

      if (typing) {
        broadcastTyping(true);

        // Auto-clear after timeout using Debouncer (no setTimeout allowed)
        if (!typingDebouncerRef.current) {
          typingDebouncerRef.current = new Debouncer(
            () => broadcastTyping(false),
            { wait: TYPING_TIMEOUT },
          );
        }
        typingDebouncerRef.current.maybeExecute();
      } else {
        broadcastTyping(false);
      }
    },
    [broadcastTyping],
  );

  // Create debounced typing trigger using TanStack Pacer
  const debouncedSetTyping = useMemo(
    () =>
      new Debouncer(() => setTypingState(true), {
        wait: DEBOUNCE_DELAY,
      }),
    [setTypingState],
  );

  // Handle input change with debouncing
  const handleInputChange = useCallback(
    (text: string) => {
      if (text === lastTextRef.current) return;
      lastTextRef.current = text;

      if (text.length > 0) {
        debouncedSetTyping.maybeExecute();
      } else {
        debouncedSetTyping.cancel();
        setTypingState(false);
      }
    },
    [setTypingState, debouncedSetTyping],
  );

  // Subscribe to Supabase Realtime broadcast channel
  useEffect(() => {
    if (!enabled || !user?.id || !conversationId) return;

    const channelName = `typing:${conversationId}`;
    const channel = supabase.channel(channelName);

    channel
      .on("broadcast", { event: "typing" }, (payload) => {
        const { userId, typing } = payload.payload as {
          userId: string;
          username?: string;
          typing: boolean;
        };

        // Ignore own typing events
        if (userId === user.id) return;

        if (typing) {
          setTypingUsers((prev) =>
            prev.includes(userId) ? prev : [...prev, userId],
          );

          // Auto-clear remote user after timeout — Debouncer per user (no setTimeout)
          if (remoteDebouncersRef.current[userId]) {
            remoteDebouncersRef.current[userId].cancel();
          } else {
            remoteDebouncersRef.current[userId] = new Debouncer(
              () => {
                setTypingUsers((prev) => prev.filter((id) => id !== userId));
                delete remoteDebouncersRef.current[userId];
              },
              { wait: TYPING_TIMEOUT },
            );
          }
          remoteDebouncersRef.current[userId].maybeExecute();
        } else {
          setTypingUsers((prev) => prev.filter((id) => id !== userId));
          if (remoteDebouncersRef.current[userId]) {
            remoteDebouncersRef.current[userId].cancel();
            delete remoteDebouncersRef.current[userId];
          }
        }
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      // Broadcast stop typing before leaving
      channel.send({
        type: "broadcast",
        event: "typing",
        payload: { userId: user.id, typing: false },
      });

      supabase.removeChannel(channel);
      channelRef.current = null;

      // Cancel all remote debouncers
      Object.values(remoteDebouncersRef.current).forEach((d) => d.cancel());
      remoteDebouncersRef.current = {};
    };
  }, [conversationId, user?.id, enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      typingDebouncerRef.current?.cancel();
      debouncedSetTyping.cancel();
    };
  }, [debouncedSetTyping]);

  return {
    isTyping,
    typingUsers,
    setTyping: setTypingState,
    handleInputChange,
  };
}
