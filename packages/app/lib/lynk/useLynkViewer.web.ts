/**
 * useLynkViewer (WEB) — subscribe to a Lynk room namespace over MoQ and render
 * one canvas per live publisher, discovery-driven (no reload when a cohost joins
 * or drops).
 *
 * Transport: `@moq` directly (browser WebTransport + WebCodecs → `<canvas>`).
 *   - subscribe token (namespace-scoped) ← `lynk-moq-token`
 *   - `new Moq.Connection.Reload({ url })` → auto-reconnect (`Connection.Reload`
 *     semantics) with a reactive `announced: Getter<Set<Path>>`
 *   - read `announced` to mount/unmount a `Watch.MultiBackend({ element: canvas,
 *     broadcast: new Watch.Broadcast({ name: path }) })` per publisher path
 *   - latency mode `"real-time"`; volume/muted on the audio backend
 *
 * A viewer NEVER publishes — the token is subscribe-only and there is no publish
 * affordance here. Teardown on `leave()` (call from unmount/leave/background) is
 * a privacy requirement, not a nicety.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Moq from "@moq/lite";
import * as Watch from "@moq/watch";
import { Signal } from "@moq/signals";
import { useMoqToken } from "./useMoqToken";
import { deriveLynkState } from "./lynkState";
import { useSignalValue } from "./moq-signals-react";
import type { LynkPublisher, LynkViewerBase } from "./types";

export interface UseLynkViewerResult extends LynkViewerBase {
  /** Attach/detach a `<canvas>` for a publisher path. Pass `null` to detach. */
  attachCanvas: (path: string, canvas: HTMLCanvasElement | null) => void;
}

/** A single connection + its empty-Set fallback live outside React state. */
const EMPTY_PATHS = new Set<Moq.Path.Valid>();

export function useLynkViewer(roomId: string | undefined): UseLynkViewerResult {
  const { token, error: tokenError } = useMoqToken(roomId, "subscribe", !!roomId);

  // One reactive URL signal feeds Connection.Reload; token refresh updates it.
  const urlSignal = useRef(new Signal<URL | undefined>(undefined));
  const reloadRef = useRef<Moq.Connection.Reload | null>(null);
  const backends = useRef(new Map<string, Watch.MultiBackend>());

  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [ended] = useState(false);

  // Build the Reload connection once.
  if (!reloadRef.current && typeof window !== "undefined") {
    reloadRef.current = new Moq.Connection.Reload({
      url: urlSignal.current,
      enabled: true,
    });
  }
  const reload = reloadRef.current;

  // Push the relay URL into the signal whenever the token (re)mints.
  useEffect(() => {
    if (token?.relayUrl) urlSignal.current.set(new URL(token.relayUrl));
  }, [token?.relayUrl]);

  // Reactive connection status + announced publisher paths.
  const status = useSignalValue(
    reload?.status ?? new Signal<Moq.Connection.ReloadStatus>("connecting"),
  );
  const announced = useSignalValue(
    reload?.announced ?? new Signal<Set<Moq.Path.Valid>>(EMPTY_PATHS),
  );

  // Map announced paths under our namespace → publishers (1..N).
  const namespace = token?.namespace ?? (roomId ? `lynk/${roomId}` : "");
  const publishers = useMemo<LynkPublisher[]>(() => {
    const out: LynkPublisher[] = [];
    for (const p of announced) {
      const path = String(p);
      if (namespace && !path.startsWith(namespace + "/")) continue;
      out.push({ path, peerId: path.slice(path.lastIndexOf("/") + 1) });
    }
    return out;
  }, [announced, namespace]);

  // Detach backends for publishers that dropped.
  useEffect(() => {
    const live = new Set(publishers.map((p) => p.path));
    for (const [path, backend] of backends.current) {
      if (!live.has(path)) {
        backend.close();
        backends.current.delete(path);
      }
    }
  }, [publishers]);

  const attachCanvas = useCallback(
    (path: string, canvas: HTMLCanvasElement | null) => {
      const existing = backends.current.get(path);
      if (!canvas) {
        if (existing) {
          existing.close();
          backends.current.delete(path);
        }
        return;
      }
      if (existing) {
        existing.element.set(canvas);
        return;
      }
      if (!reload) return;
      const backend = new Watch.MultiBackend({
        element: canvas,
        broadcast: new Watch.Broadcast({
          connection: reload.established,
          name: Moq.Path.from(path),
          enabled: true,
        }),
        latency: "real-time",
        paused: false,
      });
      backend.audio.muted.set(muted);
      backend.audio.volume.set(volume);
      backends.current.set(path, backend);
    },
    [reload, muted, volume],
  );

  const setMuted = useCallback((m: boolean) => {
    setMutedState(m);
    for (const b of backends.current.values()) b.audio.muted.set(m);
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    for (const b of backends.current.values()) b.audio.volume.set(clamped);
  }, []);

  const leave = useCallback(() => {
    for (const b of backends.current.values()) b.close();
    backends.current.clear();
    reloadRef.current?.close();
    reloadRef.current = null;
  }, []);

  // Teardown on unmount (privacy: stop pulling media when we leave).
  useEffect(() => () => leave(), [leave]);

  const state = deriveLynkState({
    hasToken: !!token,
    connection: reload ? status : undefined,
    hasMedia: publishers.length > 0,
    ended,
    error: !!tokenError,
  });

  return {
    state,
    error: tokenError,
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
