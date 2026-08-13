/**
 * useLynkViewer (NATIVE) — Fishjam WHIP/WHEP livestream (true native, no WebView).
 *
 * A Fishjam livestream is one-streamer → many-viewers, so the room may have N
 * publishers (host + cohost + speakers), each with their own livestream room.
 * This hook polls `lynk-livestream-token` (subscribe) for the current set of
 * active publishers + a viewer token each; the screen renders one
 * `LivestreamViewerTile.native` per publisher, which calls
 * `useLivestreamViewer()` → native `MediaStream` → `<VideoTile stream>` →
 * `RTCView`. No publish affordance — viewer tokens cannot stream.
 *
 * Discovery is poll-based here (the equivalent of MoQ's reactive `announced`);
 * Supabase realtime on `video_room_members` is the natural enhancement.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { deriveLynkState } from "./lynkState";
import type { LynkState } from "./lynkState";
import {
  fetchLivestreamSubscribe,
  type LivestreamSubscribeStream,
} from "./livestreamToken";

const POLL_MS = 4000;

export interface UseLynkViewerNativeResult {
  state: LynkState;
  error: string | null;
  /** Active publishers + viewer tokens (one RTCView tile each). */
  publishers: LivestreamSubscribeStream[];
  viewerCount: number;
  muted: boolean;
  setMuted: (m: boolean) => void;
  volume: number;
  setVolume: (v: number) => void;
  leave: () => void;
}

export function useLynkViewer(roomId: string | undefined): UseLynkViewerNativeResult {
  const [publishers, setPublishers] = useState<LivestreamSubscribeStream[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);

  const poll = useCallback(async () => {
    if (!roomId) return;
    try {
      const streams = await fetchLivestreamSubscribe(roomId);
      if (!alive.current) return;
      setPublishers(streams);
      setError(null);
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "Subscribe error");
    } finally {
      if (alive.current) setLoadedOnce(true);
    }
  }, [roomId]);

  useEffect(() => {
    alive.current = true;
    void poll();
    timer.current = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);

  const leave = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  const state = deriveLynkState({
    hasToken: loadedOnce,
    connection: loadedOnce ? "connected" : "connecting",
    hasMedia: publishers.length > 0,
    ended: false,
    error: !!error,
  });

  return {
    state,
    error,
    publishers,
    viewerCount: 0,
    muted,
    setMuted,
    volume,
    setVolume,
    leave,
  };
}
