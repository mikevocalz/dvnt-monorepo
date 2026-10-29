/**
 * useLynkViewer (WEB) — subscribe to a Lynk room namespace over MoQ and render
 * one canvas per live publisher, discovery-driven (no reload when a cohost joins
 * or drops).
 *
 * Transport: `@moq` directly (browser WebTransport + WebCodecs → `<canvas>`).
 *   - subscribe token (namespace-scoped) ← `lynk-moq-token`
 *   - `new Moq.Connection({ url })` → auto-reconnect (`Connection`
 *     semantics) with the live origin broadcast map
 *   - read the connection origin's broadcasts to mount one `Watch.Player`
 *     per publisher. Player owns its broadcast, decoders, renderer and audio.
 *   - zero target delay keeps audio enabled for real-time conversation.
 *
 * A viewer NEVER publishes — the token is subscribe-only and there is no publish
 * affordance here. Teardown on `leave()` (call from unmount/leave/background) is
 * a privacy requirement, not a nicety.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Moq from "@moq/net";
import * as Watch from "@moq/watch";
import { Signal, Computed } from "@moq/signals";
import { useMoqToken } from "./useMoqToken";
import { deriveLynkState } from "./lynkState";
import { useSignalValue, useSignalSetKey } from "./moq-signals-react";
import type { LynkPublisher, LynkViewerBase } from "./types";

export interface UseLynkViewerResult extends LynkViewerBase {
  /** Attach/detach a `<canvas>` for a publisher path. Pass `null` to detach. */
  attachCanvas: (path: string, canvas: HTMLCanvasElement | null) => void;
}

/** A single connection + its empty-Set fallback live outside React state. */
const EMPTY_PATHS = new Set<Moq.Path.Valid>();

export function useLynkViewer(roomId: string | undefined): UseLynkViewerResult {
  const { token, error: tokenError } = useMoqToken(roomId, "subscribe", !!roomId);

  // One reactive URL signal feeds Connection; token refresh updates it.
  const urlSignal = useRef(new Signal<URL | undefined>(undefined));
  const reloadRef = useRef<Moq.Connection | null>(null);
  const backends = useRef(new Map<string, {
    player: Watch.Player;
    canvas: Signal<HTMLCanvasElement | undefined>;
    disposeVideo: () => void;
  }>());

  const [videoAvailability, setVideoAvailability] = useState<Record<string, boolean>>({});
  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [ended, setEnded] = useState(false);
  const mutedSignal = useRef(new Signal(false));
  const volumeSignal = useRef(new Signal(1));
  const [paths, setPaths] = useState<Computed<Set<Moq.Path.Valid>> | null>(null);
  const [reload, setReload] = useState<Moq.Connection | null>(null);

  // Effects own construction AND cleanup. A render-created connection is
  // already closed after StrictMode/Fast Refresh replays effects; React need
  // not render between cleanup and setup to rebuild it.
  useEffect(() => {
    setEnded(false);
    if (!roomId || typeof window === "undefined") return;
    urlSignal.current.set(undefined);
    const connection = new Moq.Connection({
      url: urlSignal.current,
      enabled: true,
      share: false,
      linger: Moq.Time.Milli.zero,
      delay: { timeout: Moq.Time.Milli.zero },
    });
    const announced = new Computed((effect) => {
      const origin = effect.get(connection.origin);
      return origin ? new Set(effect.get(origin.broadcasts()).keys()) : EMPTY_PATHS;
    });
    setPaths(announced);
    reloadRef.current = connection;
    setReload(connection);
    return () => {
      for (const entry of backends.current.values()) {
        entry.disposeVideo();
        entry.player.close();
      }
      backends.current.clear();
      announced.close();
      setPaths((current) => current === announced ? null : current);
      connection.close();
      if (reloadRef.current === connection) reloadRef.current = null;
      setReload((current: Moq.Connection | null) => current === connection ? null : current);
    };
  }, [roomId]);

  // Push the relay URL into the signal whenever the token (re)mints.
  useEffect(() => {
    urlSignal.current.set(!ended && token?.relayUrl ? new URL(token.relayUrl) : undefined);
  }, [token?.relayUrl, ended, reload]);

  // Reactive connection status + announced publisher paths.
  const status = useSignalValue(
    reload?.status ?? new Signal<Moq.Connection.Status>("connecting"),
  );
  const connectionError = useSignalValue(
    reload?.error ?? new Signal<Error | undefined>(undefined),
  );
  const error = tokenError ?? connectionError?.message ?? null;
  // A stable STRING makes origin replacement and mutable-collection updates
  // visible to React, including Computed's initial empty microtask.
  const announcedKey = useSignalSetKey(
    paths ?? new Signal<Set<Moq.Path.Valid>>(EMPTY_PATHS),
  );

  // Map announced paths under our namespace → publishers (1..N).
  const namespace = token?.namespace ?? (roomId ? `lynk/${roomId}` : "");
  const publishers = useMemo<LynkPublisher[]>(() => {
    const out: LynkPublisher[] = [];
    for (const path of announcedKey ? announcedKey.split("\n") : []) {
      if (!path) continue;
      if (namespace && !path.startsWith(namespace + "/")) continue;
      out.push({ path, peerId: path.slice(path.lastIndexOf("/") + 1), videoAvailable: videoAvailability[path] === true });
    }
    return out;
  }, [announcedKey, namespace, videoAvailability]);

  // Detach backends for publishers that dropped.
  useEffect(() => {
    const live = new Set(publishers.map((p) => p.path));
    for (const [path, entry] of backends.current) {
      if (!live.has(path)) {
        entry.disposeVideo();
        entry.player.close();
        backends.current.delete(path);
      }
    }
  }, [publishers]);

  const attachCanvas = useCallback(
    (path: string, canvas: HTMLCanvasElement | null) => {
      const existing = backends.current.get(path);
      if (!canvas) {
        // React ref callbacks may detach/reattach in the same commit. Do not
        // restart the decoder/audio for that churn, but release a truly removed
        // tile (e.g. a roster removal before relay discovery catches up).
        existing?.canvas.set(undefined);
        if (existing) queueMicrotask(() => {
          if (backends.current.get(path) !== existing || existing.canvas.peek()) return;
          existing.disposeVideo();
          existing.player.close();
          backends.current.delete(path);
        });
        return;
      }
      if (existing) {
        existing.canvas.set(canvas);
        return;
      }
      if (!reload || reloadRef.current !== reload || ended) return;
      const target = new Signal<HTMLCanvasElement | undefined>(canvas);
      const player = new Watch.Player({
        origin: reload.origin,
        probe: reload.probe,
        name: Moq.Path.from(path),
        enabled: true,
        canvas: target,
        // "instant" also disables audio; zero delay preserves conversation.
        delay: Moq.Time.Milli.zero,
        paused: false,
        muted: mutedSignal.current,
        volume: volumeSignal.current,
      });
      // Discovery also announces audio-only publishers. Wait for a usable
      // rendition and decoded frame; publisher capture suspension removes the
      // rendition without disconnecting the peer's audio.
      let unavailableFrame: VideoFrame | undefined;
      const available = new Computed((effect) => {
        const config = effect.get(player.video.source.out.config);
        const frame = effect.get(player.video.out.frame);
        if (!config || config.stalled) {
          unavailableFrame = frame;
          return false;
        }
        // The SDK can retain its last frame after a rendition disappears.
        // Restoration is not usable until a NEW frame arrives for this epoch.
        return !!frame && frame !== unavailableFrame;
      });
      const updateVideo = () => {
        const value = available.peek() === true;
        setVideoAvailability(current => current[path] === value ? current : { ...current, [path]: value });
      };
      const unsubscribe = available.subscribe(updateVideo);
      updateVideo();
      backends.current.set(path, { player, canvas: target, disposeVideo: () => {
        unsubscribe();
        available.close();
        setVideoAvailability(current => {
          if (!(path in current)) return current;
          const next = { ...current }; delete next[path]; return next;
        });
      } });
    },
    [reload, ended],
  );

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    mutedSignal.current.set(m);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    volumeSignal.current.set(clamped);
  }, []);

  const leave = useCallback(() => {
    setEnded(true);
    for (const b of backends.current.values()) {
      b.disposeVideo();
      b.player.close();
    }
    backends.current.clear();
    reloadRef.current?.close();
    reloadRef.current = null;
  }, []);

  const state = deriveLynkState({
    hasToken: !!token,
    connection: reload ? status : undefined,
    hasMedia: publishers.length > 0,
    ended,
    error: !!error,
  });

  return {
    state,
    error,
    publishers,
    viewerCount: 0, // wired by the screen from existing room presence (useRoomEvents)
    muted,
    setMuted,
    volume,
    setVolume,
    attachCanvas,
    leave,
  };
}
