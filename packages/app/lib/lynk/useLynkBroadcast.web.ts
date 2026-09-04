/**
 * useLynkBroadcast (WEB) — host/cohost publish camera + mic to a Lynk room over
 * MoQ, and watch co-publishers (e.g. the other broadcaster) via discovery.
 *
 * Transport: `@moq` directly.
 *   - publish token (own peer path) ← `lynk-moq-token` (intent: "publish")
 *   - `new Moq.Connection.Reload({ url })` for auto-reconnect
 *   - `Publish.Source.Camera` / `Publish.Source.Microphone` → `Publish.Broadcast`
 *     under `lynk/${roomId}/${peerId}`; `enabled` toggles mute camera/mic
 *   - co-publishers are discovered by composing `useLynkViewer` (a SEPARATE,
 *     subscribe-scoped connection — MoQ tokens are single-purpose, so a publisher
 *     needs both a publish token to send and a subscribe token to watch others)
 *
 * Capture is gated on `canPublish`, exactly like the native sibling: the
 * sources are constructed DISABLED and a single effect drives
 * `enabled = flag && !ended && canPublish`. Constructing them enabled opened the
 * camera the instant the hook mounted, so a listener in an audio-only Sneaky
 * Lynk room got a camera permission prompt for a device they can never publish.
 *
 * Teardown on `end()` stops the camera/mic publish — a stream that keeps
 * publishing after you navigate away is a privacy incident, so the screen MUST
 * call `end()` on unmount/leave/background.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Moq from "@moq/lite";
import * as Publish from "@moq/publish";
import { Signal, type Getter } from "@moq/signals";
import { useMoqToken } from "./useMoqToken";
import { useLynkViewer } from "./useLynkViewer.web";
import { deriveLynkState } from "./lynkState";
import { useSignalValue } from "./moq-signals-react";
import type { LynkBroadcastBase, LynkPublisher } from "./types";

export interface UseLynkBroadcastResult extends LynkBroadcastBase {
  /** Local camera preview for the broadcaster's own tile. */
  localStream: MediaStream | null;
  /**
   * The local microphone capture, for client-side VAD (`useSpeakingDetection`).
   * MoQ carries no voice-activity signal, so a speaking ring is computed from
   * this stream rather than received from the transport.
   */
  localAudioStream: MediaStream | null;
  /** Attach/detach a `<canvas>` for a co-publisher path (the cohost). */
  attachCanvas: (path: string, canvas: HTMLCanvasElement | null) => void;
}

export function useLynkBroadcast(
  roomId: string | undefined,
  canPublish = true,
): UseLynkBroadcastResult {
  const { token, error: tokenError } = useMoqToken(
    roomId,
    "publish",
    !!roomId && canPublish,
  );
  // Compose the viewer for co-publisher discovery + canvas mounting.
  const viewer = useLynkViewer(roomId);

  const urlSignal = useRef(new Signal<URL | undefined>(undefined));
  const reloadRef = useRef<Moq.Connection.Reload | null>(null);
  const cameraRef = useRef<Publish.Source.Camera | null>(null);
  const micRef = useRef<Publish.Source.Microphone | null>(null);
  const broadcastRef = useRef<Publish.Broadcast | null>(null);

  const [isLive, setIsLive] = useState(false);
  const [cameraEnabled, setCameraEnabledState] = useState(true);
  const [micEnabled, setMicEnabledState] = useState(true);
  const [ended, setEnded] = useState(false);

  const isBrowser = typeof window !== "undefined";

  // Lazily create the publish connection + media sources (browser only).
  if (isBrowser) {
    if (!reloadRef.current) {
      reloadRef.current = new Moq.Connection.Reload({
        url: urlSignal.current,
        enabled: true,
      });
    }
    // Constructed DISABLED — the effect below opens the devices once we know
    // this member may publish. See the header note.
    if (!cameraRef.current) {
      cameraRef.current = new Publish.Source.Camera({ enabled: false });
    }
    if (!micRef.current) {
      micRef.current = new Publish.Source.Microphone({ enabled: false });
    }
  }
  const reload = reloadRef.current;
  const camera = cameraRef.current;
  const mic = micRef.current;

  useEffect(() => {
    if (token?.relayUrl) urlSignal.current.set(new URL(token.relayUrl));
  }, [token?.relayUrl]);

  const status = useSignalValue(
    reload?.status ?? new Signal<Moq.Connection.ReloadStatus>("connecting"),
  );
  // `camera.source` is `Signal<Video.StreamTrack | undefined>` (StreamTrack
  // extends MediaStreamTrack); widen to the base type for the local preview.
  const cameraSource = (camera?.source ??
    new Signal<MediaStreamTrack | undefined>(undefined)) as Getter<
    MediaStreamTrack | undefined
  >;
  const cameraTrack = useSignalValue(cameraSource);
  const localStream = useMemo(
    () => (cameraTrack ? new MediaStream([cameraTrack]) : null),
    [cameraTrack],
  );

  // `mic.source` is `Signal<Audio.Source | undefined>`, and Audio.Source is
  // either the track itself or `{ track, kind }` — normalize to the track.
  const micSource = (mic?.source ??
    new Signal<Publish.Audio.Source | undefined>(undefined)) as Getter<
    Publish.Audio.Source | undefined
  >;
  const micSourceValue = useSignalValue(micSource);
  const micTrack =
    micSourceValue && "track" in micSourceValue
      ? micSourceValue.track
      : micSourceValue;
  const localAudioStream = useMemo(
    () => (micTrack ? new MediaStream([micTrack]) : null),
    [micTrack],
  );

  // Capture follows the flags AND the role. Same rule as the native hook, where
  // it is `useCamera({ enabled: cameraEnabled && !ended && canPublish })`.
  useEffect(() => {
    camera?.enabled.set(cameraEnabled && !ended && canPublish);
  }, [camera, cameraEnabled, ended, canPublish]);

  useEffect(() => {
    mic?.enabled.set(micEnabled && !ended && canPublish);
  }, [mic, micEnabled, ended, canPublish]);

  const goLive = useCallback(async () => {
    if (!canPublish) return;
    if (!reload || !camera || !mic || !token || broadcastRef.current) return;
    broadcastRef.current = new Publish.Broadcast({
      connection: reload.established,
      name: Moq.Path.from(token.path),
      enabled: true,
      video: { source: camera.source, hd: { enabled: true } },
      audio: { enabled: true, source: mic.source },
    });
    setIsLive(true);
  }, [reload, camera, mic, token, canPublish]);

  // State only — the effect above is what touches the device, so the gate can
  // never be bypassed by a toggle that fires before the role has landed.
  const setCameraEnabled = useCallback((on: boolean) => {
    setCameraEnabledState(on);
  }, []);
  const setMicEnabled = useCallback((on: boolean) => {
    setMicEnabledState(on);
  }, []);

  const end = useCallback(() => {
    setEnded(true);
    setIsLive(false);
    broadcastRef.current?.close();
    broadcastRef.current = null;
    cameraRef.current?.close();
    micRef.current?.close();
    reloadRef.current?.close();
    reloadRef.current = null;
    viewer.leave();
  }, [viewer]);

  // Privacy teardown: stop publishing on unmount.
  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Co-publishers = everyone discovered except ourselves.
  const coPublishers = useMemo<LynkPublisher[]>(
    () => viewer.publishers.filter((p) => p.peerId !== token?.peerId),
    [viewer.publishers, token?.peerId],
  );

  // A listener requests NO publish token (`canPublish` false), so the publish
  // lifecycle has nothing to report and `deriveLynkState` would sit at
  // `requesting-token` forever. Their real state is the composed viewer's — the
  // subscribe connection is the one they actually have.
  const state = canPublish
    ? deriveLynkState({
        hasToken: !!token,
        connection: reload ? status : undefined,
        hasMedia: isLive,
        ended,
        error: !!tokenError,
      })
    : viewer.state;

  return {
    state,
    error: canPublish ? tokenError : viewer.error,
    isLive,
    localStream,
    localAudioStream,
    cameraEnabled,
    micEnabled,
    setCameraEnabled,
    setMicEnabled,
    coPublishers,
    viewerCount: viewer.viewerCount,
    attachCanvas: viewer.attachCanvas,
    goLive,
    end,
  };
}
