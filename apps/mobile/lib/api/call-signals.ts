/**
 * Call Signaling API
 *
 * Uses Supabase Realtime to notify callees of incoming calls.
 * Signals are stored in call_signals table and subscribed via Realtime.
 */

import { supabase } from "../supabase/client";

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
  ): () => void {
    console.log("[CallSignals] Subscribing to calls for:", userAuthId);

    // Dedupe: track room_ids we've already shown incoming UI for
    // to prevent multiple signals for the same call from canceling each other
    const _seenRoomIds = new Set<string>();

    const channel = supabase
      .channel(`call_signals:${userAuthId}`)
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
          if (signal.status === "ringing") {
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
};
