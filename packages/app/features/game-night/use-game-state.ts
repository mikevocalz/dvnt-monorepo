"use client";

/**
 * Live Game Night room state for the current member.
 *
 * Fetches once, then keeps in sync with postgres_changes on the tables that
 * drive the state projection (matches, rounds, messages) plus a 20s ping poll
 * so deadlines advance even when nobody else acts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchState, ping } from "./rooms-api";
import type { GameNightState } from "./rooms-api";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { supabase } from "@dvnt/app/lib/supabase/client";

export type GameNightStatus =
  | "idle"
  | "loading"
  | "ready"
  | "error"
  | "not_found";

export interface UseGameNightStateResult {
  state: GameNightState | null;
  status: GameNightStatus;
  error: string | null;
  refresh: () => Promise<void>;
}

const ROOM_NOT_FOUND_MESSAGE = "That room doesn't exist or already ended.";

export function useGameNightState(
  code: string | undefined,
): UseGameNightStateResult {
  const [state, setState] = useState<GameNightState | null>(null);
  const [status, setStatus] = useState<GameNightStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const codeRef = useRef(code);
  const stateRef = useRef<GameNightState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const next = await fetchState(code);
      if (codeRef.current !== code) return; // stale
      stateRef.current = next;
      setState(next);
      setError(null);
      if (next.room.status === "ended" || next.me.member === false) {
        setStatus("not_found");
      } else {
        setStatus("ready");
      }
    } catch (err) {
      if (codeRef.current !== code) return;
      const msg = err instanceof Error ? err.message : String(err);
      stateRef.current = null;
      setState(null);
      if (msg === ROOM_NOT_FOUND_MESSAGE) {
        setStatus("not_found");
        setError(null);
      } else {
        setStatus("error");
        setError(msg);
      }
    }
  }, [code]);

  // Initial fetch + online/offline handling.
  useEffect(() => {
    if (!code) {
      setStatus("idle");
      setState(null);
      setError(null);
      return;
    }

    setStatus((prev) => (prev === "ready" ? "ready" : "loading"));
    void refresh();

    const onlineSupported =
      typeof window !== "undefined" && "onLine" in navigator;
    const handleOnline = () => {
      void refresh();
    };
    if (onlineSupported) {
      window.addEventListener("online", handleOnline);
    }
    return () => {
      if (onlineSupported) {
        window.removeEventListener("online", handleOnline);
      }
    };
  }, [code, refresh]);

  // Realtime: refresh on changes to matches, rounds, or messages for this room.
  useEffect(() => {
    if (!code || status !== "ready") return;
    const roomId = stateRef.current?.room.id;
    if (!roomId) return;

    const scheduleRefresh = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void refresh();
      }, 300);
    };

    const channel = freshChannel(`game-night-state:${code}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_night_matches",
          filter: `room_id=eq.${roomId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_night_rounds",
          filter: `room_id=eq.${roomId}`,
        },
        scheduleRefresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_night_messages",
          filter: `room_id=eq.${roomId}`,
        },
        scheduleRefresh,
      )
      .subscribe();

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      void supabase.removeChannel(channel);
    };
  }, [code, status, refresh]);

  // Poll: ping advances deadlines, then refresh the projection.
  useEffect(() => {
    if (!code || status !== "ready") return;

    const tick = () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;
      void ping(code).catch(() => {
        // ping is best-effort; refresh below surfaces real errors.
      });
      void refresh();
    };

    const id = window.setInterval(tick, 20_000);
    return () => window.clearInterval(id);
  }, [code, status, refresh]);

  return { state, status, error, refresh };
}
