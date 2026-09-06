/**
 * Call Signaling API
 *
 * Uses Supabase Realtime to notify callees of incoming calls.
 * Signals are stored in call_signals table and subscribed via Realtime.
 */

import { supabase } from "../supabase/client";
import { freshChannel } from "../supabase/realtime";

export interface CallSignal {
  id: number;
  room_id: string;
  caller_id: string;
  caller_username: string | null;
  caller_avatar: string | null;
  callee_id: string;
  status: "ringing" | "accepted" | "declined" | "missed" | "ended";
  is_group: boolean;
  call_type: "audio" | "video";
  created_at: string;
}

export const callSignalsApi = {
  /** Notifications are hints; only a current recipient-bound signal may ring. */
  async getFreshIncomingSignal(roomId: string, calleeId: string): Promise<CallSignal | null> {
    const { data, error } = await supabase.from("call_signals").select("*")
      .eq("room_id", roomId).eq("callee_id", calleeId).eq("status", "ringing")
      .gte("created_at", new Date(Date.now() - 30_000).toISOString())
      .lte("created_at", new Date(Date.now() + 5_000).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data || Date.now() - Date.parse(data.created_at) >= 30_000) return null;
    return data as CallSignal;
  },

  /**
   * Send a call signal to one or more users
   */
  async sendCallSignal(params: {
    roomId: string;
    callerId: string;
    calleeIds: string[];
    callerUsername?: string;
    callerAvatar?: string;
    isGroup?: boolean;
    callType?: "audio" | "video";
  }): Promise<void> {
    const callerId = params.callerId;
    if (!callerId) throw new Error("Not authenticated");

    const signals = params.calleeIds.map((calleeId) => ({
      room_id: params.roomId,
      caller_id: callerId,
      caller_username: params.callerUsername || null,
      caller_avatar: params.callerAvatar || null,
      callee_id: calleeId,
      status: "ringing" as const,
      is_group: params.isGroup || false,
      call_type: params.callType || "video",
    }));

    const { error } = await supabase.from("call_signals").insert(signals);
    if (error) {
      console.error("[CallSignals] Failed to send signal:", error.message);
      throw error;
    }
    console.log(
      "[CallSignals] Sent call signal to",
      params.calleeIds.length,
      "users",
    );
  },

  /**
   * Update a call signal status (accept, decline, etc.)
   */
  async updateSignalStatus(
    signalId: number,
    status: CallSignal["status"],
  ): Promise<void> {
    const { error } = await supabase
      .from("call_signals")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", signalId);

    if (error) {
      console.error("[CallSignals] Failed to update signal:", error.message);
      throw error;
    }
  },

  async answerRingingSignal(signalId: number, calleeId?: string, roomId?: string): Promise<boolean> {
    let query = supabase.from("call_signals")
      .update({ status: "accepted", updated_at: new Date().toISOString() })
      .eq("id", signalId).eq("status", "ringing")
      .gte("created_at", new Date(Date.now() - 30_000).toISOString())
      .lte("created_at", new Date(Date.now() + 5_000).toISOString());
    if (calleeId) query = query.eq("callee_id", calleeId);
    if (roomId) query = query.eq("room_id", roomId);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throw error;
    return !!data;
  },

  async declineRingingSignal(signalId: number, calleeId: string, roomId: string): Promise<boolean> {
    const { data, error } = await supabase.from("call_signals")
      .update({ status: "declined", updated_at: new Date().toISOString() })
      .eq("id", signalId).eq("callee_id", calleeId).eq("room_id", roomId).eq("status", "ringing")
      .gte("created_at", new Date(Date.now() - 30_000).toISOString())
      .lte("created_at", new Date(Date.now() + 5_000).toISOString()).select("id").maybeSingle();
    if (error) throw error;
    return !!data;
  },

  /**
   * End all ringing signals for a room
   */
  async endCallSignals(roomId: string): Promise<void> {
    // Update ALL non-terminal signals for this room to "ended".
    // Previously only updated "ringing" signals, which meant "accepted" signals
    // were never marked as ended — the caller's Realtime subscription never fired.
    const { error } = await supabase
      .from("call_signals")
      .update({ status: "ended", updated_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .in("status", ["ringing", "accepted"]);

    if (error) {
      console.error("[CallSignals] Failed to end signals:", error.message);
    }
  },

  /**
   * Mark all ringing signals for a room as "missed".
   * Called by the caller when the ring timeout expires (callee didn't answer).
   */
  async missCallSignals(roomId: string): Promise<void> {
    const { error } = await supabase
      .from("call_signals")
      .update({ status: "missed", updated_at: new Date().toISOString() })
      .eq("room_id", roomId)
      .eq("status", "ringing");

    if (error) {
      console.error(
        "[CallSignals] Failed to mark signals as missed:",
        error.message,
      );
    } else {
      console.log(
        "[CallSignals] Marked ringing signals as missed for room:",
        roomId,
      );
    }
  },

  /**
   * Check if there's an existing ringing signal FROM the target user TO the current user.
   * Used for call collision detection — if both users call each other simultaneously,
   * the second caller should join the first caller's room instead of creating a new one.
   * Returns the existing signal if found, null otherwise.
   */
  async checkCollision(
    currentUserId: string,
    targetUserId: string,
  ): Promise<CallSignal | null> {
    const { data, error } = await supabase
      .from("call_signals")
      .select("*")
      .eq("caller_id", targetUserId)
      .eq("callee_id", currentUserId)
      .in("status", ["ringing", "accepted"])
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;

    // Only consider signals from the last 30 seconds to avoid stale collisions
    const signalAge = Date.now() - new Date(data.created_at).getTime();
    if (signalAge > 30000) return null;

    console.log(
      `[CallSignals] COLLISION detected: ${targetUserId} is already calling ${currentUserId} in room ${data.room_id}`,
    );
    return data as CallSignal;
  },

  /**
   * Subscribe to incoming call signals for the current user.
   * Returns an unsubscribe function.
   */
  subscribeToIncomingCalls(
    userAuthId: string,
    onIncomingCall: (signal: CallSignal) => void,
    /**
     * The call stopped being live — caller hung up, or it was declined,
     * missed or answered elsewhere. Without this the callee only ever heard
     * about INSERTs, so a cancelled call kept ringing until its own timeout:
     * endCallSignals writes status "ended" with an UPDATE, and nothing was
     * listening for UPDATEs.
     */
    onCallResolved?: (signal: CallSignal) => void,
  ): () => void {
    console.log("[CallSignals] Subscribing to calls for:", userAuthId);

    // Dedupe: track room_ids we've already shown incoming UI for
    // to prevent multiple signals for the same call from canceling each other
    const _seenRoomIds = new Set<string>();

    // freshChannel, not supabase.channel — a stable topic hands back the
    // already-joined channel on remount and .on() throws. Full explanation of
    // the realtime-js behaviour lives in lib/supabase/realtime.ts.
    const channel = freshChannel(`call_signals:${userAuthId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "call_signals",
          filter: `callee_id=eq.${userAuthId}`,
        },
        (payload) => {
          const signal = payload.new as CallSignal;
          const stamp = Date.parse(signal.created_at);
          if (signal.status === "ringing" && String(signal.callee_id) === userAuthId && Number.isFinite(stamp) && stamp <= Date.now() + 5_000 && Date.now() - stamp < 30_000 && ["audio", "video"].includes(signal.call_type)) {
            // Dedupe: skip if we already showed incoming UI for this room
            if (_seenRoomIds.has(signal.room_id)) {
              console.log(
                "[CallSignals] Duplicate signal for room, ignoring:",
                signal.room_id,
              );
              return;
            }
            _seenRoomIds.add(signal.room_id);
            // Auto-clear after 60s to prevent memory leak
            setTimeout(() => _seenRoomIds.delete(signal.room_id), 60000);

            console.log(
              "[CallSignals] Incoming call from:",
              signal.caller_username,
              "room:",
              signal.room_id,
            );
            onIncomingCall(signal);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_signals",
          filter: `callee_id=eq.${userAuthId}`,
        },
        (payload) => {
          const signal = payload.new as CallSignal;
          if (String(signal.callee_id) !== userAuthId) return;
          // Anything that is no longer ringing means stop ringing. Treat the
          // terminal states explicitly rather than "not ringing", so a new
          // status added later does not silently dismiss a live call.
          if (
            signal.status === "ended" ||
            signal.status === "declined" ||
            signal.status === "missed" ||
            signal.status === "accepted"
          ) {
            console.log(
              "[CallSignals] Call resolved:",
              signal.status,
              "room:",
              signal.room_id,
            );
            // Let the same room ring again later (a call back).
            _seenRoomIds.delete(signal.room_id);
            onCallResolved?.(signal);
          }
        },
      )
      .subscribe((status) => {
        console.log("[CallSignals] Subscription status:", status);
        if (status === "CHANNEL_ERROR") {
          console.warn(
            "[CallSignals] Channel error — incoming calls may not ring!",
          );
        }
      });

    return () => {
      console.log("[CallSignals] Unsubscribing from calls");
      _seenRoomIds.clear();
      supabase.removeChannel(channel);
    };
  },

  /**
   * Subscribe to THIS room going dead, for whoever is sitting on the call
   * screen. Returns an unsubscribe function.
   *
   * subscribeToIncomingCalls is user-scoped and filters on `callee_id` plus a
   * 30s ringing-freshness window, so it can only ever tell the callee about a
   * call that has not started yet. Once a call is live, either side may hang
   * up, and the remote party's screen had nothing listening at all — it stayed
   * on the call UI after the other end left. Filtering by room covers caller
   * and callee with one subscription.
   */
  subscribeToRoomEnded(
    roomId: string,
    onEnded: (signal: CallSignal) => void,
  ): () => void {
    const channel = freshChannel(`call_room_ended:${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_signals",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const signal = payload.new as CallSignal;
          // "accepted" is not terminal — it is the answer, and firing on it
          // would tear the screen down the instant the call connects.
          if (
            signal.status === "ended" ||
            signal.status === "declined" ||
            signal.status === "missed"
          ) {
            console.log("[CallSignals] Room ended:", roomId, signal.status);
            onEnded(signal);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },
};
