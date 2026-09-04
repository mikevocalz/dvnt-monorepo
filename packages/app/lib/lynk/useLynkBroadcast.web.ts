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

  /**
   * Connection + media sources live in an EFFECT, not in render.
   *
   * They used to be created lazily during render (`if (!cameraRef.current)`)
   * and closed from an unmount cleanup. Those two halves disagree: React
   * re-runs effects without re-rendering (StrictMode does it on every mount,
   * and a Fast Refresh does it too), so the cleanup closed the camera, the
   * second effect pass found the same closed instance, and no render ever
   * happened to build a new one. `close()` closes the device's signal Effect —
   * the loop that watches `enabled` and calls getUserMedia — so from that
   * point the camera was permanently deaf: `enabled` flipped true, `source`
   * stayed undefined, and the local preview never rendered while role,
   * canPublish and cameraOn all said it should. Remote peers saw an avatar.
   *
   * Creating them here and holding them in STATE means a teardown is always
   * followed by a rebuild and a re-render that picks the new ones up.
   */
  const [devices, setDevices] = useState<{
    reload: Moq.Connection.Reload;
    camera: Publish.Source.Camera;
    mic: Publish.Source.Microphone;
  } | null>(null);

  useEffect(() => {
    if (!isBrowser) return;
    const reload = new Moq.Connection.Reload({
      url: urlSignal.current,
      enabled: true,
    });
    // Constructed DISABLED — the enable effects below open the devices once we
    // know this member may publish. See the header note.
    const camera = new Publish.Source.Camera({ enabled: false });
    const mic = new Publish.Source.Microphone({ enabled: false });
    reloadRef.current = reload;
    cameraRef.current = camera;
    micRef.current = mic;
    // A new transport is by definition not an ended one.
    //
    // `ended` is STATE, and `end()` runs from an unmount cleanup — but React
    // re-runs effects without unmounting the component, so the flag survived a
    // teardown that the devices did not. Everything downstream reads
    // `cameraEnabled && !ended && canPublish`, so the camera stayed disabled
    // forever: the room said the camera was on, the roster said you could
    // publish, and no track was ever opened.
    setEnded(false);
    setIsLive(false);
    setDevices({ reload, camera, mic });
    return () => {
      camera.close();
      mic.close();
      reload.close();
      reloadRef.current = null;
      cameraRef.current = null;
      micRef.current = null;
      setDevices(null);
    };
  }, [isBrowser]);

  const reload = devices?.reload ?? null;
  const camera = devices?.camera ?? null;
  const mic = devices?.mic ?? null;

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
    // Null these, don't just close them.
    //
    // `close()` closes the device's signal Effect — the loop that watches
    // `enabled` and calls getUserMedia. The refs are created lazily with
    // `if (!cameraRef.current)`, so a closed-but-non-null ref is reused on the
    // next mount and can NEVER open again: `enabled` flips true, nothing is
    // listening, `source` stays undefined, and the local preview never
    // renders while every other signal (role, canPublish, cameraOn) says it
    // should. The broadcast and connection refs were already nulled here; the
    // media sources were the two that were not.
    // Privacy teardown — this is what turns the camera light off. Nulling is
    // deliberately NOT done here: the effect above owns the lifecycle, and
    // `ended` already gates the enable effects.
    cameraRef.current?.close();
    micRef.current?.close();
    reloadRef.current?.close();
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
