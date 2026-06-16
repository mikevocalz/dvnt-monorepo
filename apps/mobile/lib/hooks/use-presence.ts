/**
 * Presence Hook
 *
 * Manages the current user's online/offline status and subscribes
 * to real-time presence updates for other users via Supabase Realtime.
 *
 * Usage:
 * - Call usePresenceManager() once at the app root to track own status
 * - Call useUserPresence(userId) in chat/messages to get a user's status
 */

import { useEffect, useRef, useCallback } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuthStore } from "@/lib/stores/auth-store";
import { usePresenceStore } from "@/lib/stores/presence-store";
import { presenceApi } from "@/lib/api/presence";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

const HEARTBEAT_INTERVAL = 30_000; // 30s heartbeat
const PRESENCE_CHANNEL = "global-presence";

// Singleton: supabase.channel(name) returns the SAME object for the same name,
// so if the channel is already subscribed, calling .on("presence",...) throws
// "cannot add presence callbacks after subscribe()". Keep a module-level ref
// and skip re-subscribing if the channel is still live.
let _presenceChannel: import("@supabase/supabase-js").RealtimeChannel | null = null;

/**
 * Call once at app root. Manages:
 * - Setting current user online/offline based on AppState
 * - Heartbeat to keep presence fresh
 * - Supabase Realtime Presence channel for cross-device sync
 */
export function usePresenceManager() {
  const user = useAuthStore((s) => s.user);
  const userId = user?.id ? parseInt(String(user.id), 10) : null;
  const channelRef = useRef<RealtimeChannel | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { setUserOnline, setInitialized } = usePresenceStore();

  const goOnline = useCallback(async () => {
    if (!userId || isNaN(userId)) return;
    await presenceApi.setOnline(userId);
    setUserOnline(String(userId), true);
  }, [userId, setUserOnline]);

  const goOffline = useCallback(async () => {
    if (!userId || isNaN(userId)) return;
    await presenceApi.setOffline(userId);
    setUserOnline(String(userId), false);
  }, [userId, setUserOnline]);

  // AppState listener
  useEffect(() => {
    if (!userId || isNaN(userId)) return;

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        goOnline();
      } else if (nextState === "background" || nextState === "inactive") {
        goOffline();
      }
    };

    const sub = AppState.addEventListener("change", handleAppState);

    // Go online immediately
    goOnline();
    setInitialized(true);

    return () => {
      sub.remove();
      goOffline();
    };
  }, [userId, goOnline, goOffline, setInitialized]);

  // Heartbeat
  useEffect(() => {
    if (!userId || isNaN(userId)) return;

    heartbeatRef.current = setInterval(() => {
      if (AppState.currentState === "active") {
        presenceApi.setOnline(userId);
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [userId]);

  // Supabase Realtime Presence channel
  useEffect(() => {
    if (!userId || isNaN(userId)) return;

    // Guard: if a channel is already live, don't create a duplicate.
    // supabase.channel(name) returns the same object for the same name, so
    // calling .on("presence",...) on an already-subscribed channel throws.
    if (_presenceChannel) return;

    const channel = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: String(userId) } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const store = usePresenceStore.getState();

        const onlineIds = new Set<string>();
        for (const key of Object.keys(state)) {
          onlineIds.add(key);
        }

        const updates: Array<{
          userId: string;
          isOnline: boolean;
          lastSeenAt?: string;
        }> = [];
        for (const id of onlineIds) {
          updates.push({ userId: id, isOnline: true });
        }
        for (const id of Object.keys(store.onlineUsers)) {
          if (store.onlineUsers[id] && !onlineIds.has(id)) {
            updates.push({
              userId: id,
              isOnline: false,
              lastSeenAt: new Date().toISOString(),
            });
          }
        }
        if (updates.length) store.setBulkPresence(updates);
      })
      .on("presence", { event: "join" }, ({ key }) => {
        usePresenceStore.getState().setUserOnline(key, true);
      })
      .on("presence", { event: "leave" }, ({ key }) => {
        usePresenceStore.getState().setUserOnline(key, false);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ user_id: userId, online_at: new Date().toISOString() });
        }
      });

    _presenceChannel = channel;
    channelRef.current = channel;

    return () => {
      if (_presenceChannel) {
        _presenceChannel.untrack();
        supabase.removeChannel(_presenceChannel);
        _presenceChannel = null;
      }
      channelRef.current = null;
    };
  }, [userId]);
}

/**
 * Get a specific user's online status.
 * Fetches from DB on mount, then relies on Realtime updates via the store.
 */
export function useUserPresence(userId: string | number | undefined) {
  const userIdStr = userId ? String(userId) : "";
  const userIdInt = userId ? parseInt(String(userId), 10) : NaN;
  const isOnline = usePresenceStore((s) => s.onlineUsers[userIdStr] ?? false);
  const lastSeen = usePresenceStore((s) => s.lastSeen[userIdStr] ?? "");
  const setUserOnline = usePresenceStore((s) => s.setUserOnline);
  const setUserLastSeen = usePresenceStore((s) => s.setUserLastSeen);

  // Fetch from DB on mount as initial state
  useEffect(() => {
    if (!userIdStr || isNaN(userIdInt)) return;

    presenceApi.getUserPresence(userIdInt).then((result) => {
      if (result) {
        setUserOnline(userIdStr, result.isOnline);
        if (result.lastSeenAt) setUserLastSeen(userIdStr, result.lastSeenAt);
      }
    });
  }, [userIdStr, userIdInt, setUserOnline, setUserLastSeen]);

  return { isOnline, lastSeen };
}

/**
 * Format lastSeen into a human-readable string
 */
export function formatLastSeen(lastSeenAt: string): string {
  if (!lastSeenAt) return "";
  const date = new Date(lastSeenAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return "Active now";
  if (diffMins < 60) return `Active ${diffMins}m ago`;
  if (diffHours < 24) return `Active ${diffHours}h ago`;
  return `Active ${Math.floor(diffHours / 24)}d ago`;
}
