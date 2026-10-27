/**
 * useLynkBroadcast (WEB) — host/cohost publish camera + mic to a Lynk room over
 * MoQ, and watch co-publishers (e.g. the other broadcaster) via discovery.
 *
 * Transport: `@moq` directly.
 *   - publish token (own peer path) ← `lynk-moq-token` (intent: "publish")
 *   - `new Moq.Connection({ url })` for auto-reconnect
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
import * as Moq from "@moq/net";
import * as Publish from "@moq/publish";
import { Signal, Computed } from "@moq/signals";
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
  const reloadRef = useRef<Moq.Connection | null>(null);
  const cameraRef = useRef<Publish.Source.Camera | null>(null);
  const micRef = useRef<Publish.Source.Microphone | null>(null);
  const broadcastRef = useRef<{ close(): void } | null>(null);
  const captureLifetimeActive = useRef(false);

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
    reload: Moq.Connection;
    camera: Publish.Source.Camera;
    mic: Publish.Source.Microphone;
    cameraOn: Signal<boolean>;
    micOn: Signal<boolean>;
  } | null>(null);

  useEffect(() => {
    if (!isBrowser || !roomId) return;
    captureLifetimeActive.current = true;
    urlSignal.current.set(undefined);
    const reload = new Moq.Connection({
      url: urlSignal.current,
      enabled: true,
      share: false,
      linger: Moq.Time.Milli.zero,
      delay: { timeout: Moq.Time.Milli.zero },
    });
    // Constructed DISABLED — the enable effects below open the devices once we
    // know this member may publish. See the header note.
    const cameraOn = new Signal(false);
    const micOn = new Signal(false);
    const camera = new Publish.Source.Camera({ enabled: cameraOn });
    const mic = new Publish.Source.Microphone({ enabled: micOn });
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
    setDevices({ reload, camera, mic, cameraOn, micOn });
    return () => {
      broadcastRef.current?.close();
      broadcastRef.current = null;
      captureLifetimeActive.current = false;
      // Explicit retries may have replaced either source during this lifetime.
      cameraRef.current?.close();
      micRef.current?.close();
      camera.close();
      mic.close();
      reload.close();
      reloadRef.current = null;
      cameraRef.current = null;
      micRef.current = null;
      setDevices(null);
    };
  }, [isBrowser, roomId]);

  const reload = devices?.reload ?? null;
  const camera = devices?.camera ?? null;
  const mic = devices?.mic ?? null;

  useEffect(() => {
    urlSignal.current.set(!ended && token?.relayUrl ? new URL(token.relayUrl) : undefined);
  }, [token?.relayUrl, ended, reload]);

  const status = useSignalValue(
    reload?.status ?? new Signal<Moq.Connection.Status>("connecting"),
  );
  const connectionError = useSignalValue(
    reload?.error ?? new Signal<Error | undefined>(undefined),
  );
  const cameraFailure = useSignalValue(
    camera?.out.error ?? new Signal<Error | undefined>(undefined),
  );
  const microphoneFailure = useSignalValue(
    mic?.out.error ?? new Signal<Error | undefined>(undefined),
  );
  // A local permission/device failure does not disconnect reception. Fatal
  // auth/transport errors retain their existing room recovery path separately.
  const error = tokenError ?? connectionError?.message ?? null;
  const cameraError = canPublish && !ended && cameraEnabled ? cameraFailure?.message ?? null : null;
  const microphoneError = canPublish && !ended && micEnabled ? microphoneFailure?.message ?? null : null;
  const captureError = microphoneError ?? cameraError;
  const captureIntent = useRef({ devices, canPublish, ended, cameraEnabled, micEnabled });
  captureIntent.current = { devices, canPublish, ended, cameraEnabled, micEnabled };
  const retryCapture = useCallback(() => {
    const current = captureIntent.current;
    const previous = current.devices;
    if (!captureLifetimeActive.current || !previous || current.ended || !current.canPublish) return;
    if (previous.reload !== reloadRef.current) return;
    const retryCamera = current.cameraEnabled && cameraRef.current === previous.camera && !!previous.camera.out.error.peek();
    const retryMic = current.micEnabled && micRef.current === previous.mic && !!previous.mic.out.error.peek();
    if (!retryCamera && !retryMic) return;
    // The SDK's terminal retry budget is private. Replacing only the failed
    // source guarantees a fresh budget (a synchronous off/on signal can coalesce).
    // Start disabled: even a mute/role change batched with this click wins before
    // the enable effects run. Never recreate the receiver or healthy device.
    const next = { ...previous };
    if (retryCamera) {
      previous.camera.close();
      next.cameraOn = new Signal(false);
      next.camera = new Publish.Source.Camera({ enabled: next.cameraOn });
      cameraRef.current = next.camera;
    }
    if (retryMic) {
      previous.mic.close();
      next.micOn = new Signal(false);
      next.mic = new Publish.Source.Microphone({ enabled: next.micOn });
      micRef.current = next.mic;
    }
    setDevices(next);
  }, []);
  // Source outputs contain media tracks, while capture/encoders own frames.
  const cameraMedia = useSignalValue(
    camera?.out.source ?? new Signal<Publish.Source.Media | undefined>(undefined),
  );
  const videoSource = cameraMedia?.video;
  const cameraTrack = videoSource && !("frames" in videoSource)
    ? ("track" in videoSource ? videoSource.track : videoSource)
    : undefined;
  const localStream = useMemo(
    () => (cameraTrack ? new MediaStream([cameraTrack]) : null),
    [cameraTrack],
  );

  const microphoneMedia = useSignalValue(
    mic?.out.source ?? new Signal<Publish.Source.Media | undefined>(undefined),
  );
  const audioSource = microphoneMedia?.audio;
  const micTrack = audioSource && !("samples" in audioSource)
    ? ("track" in audioSource ? audioSource.track : audioSource)
    : undefined;
  const localAudioStream = useMemo(
    () => (micTrack ? new MediaStream([micTrack]) : null),
    [micTrack],
  );

  // Capture follows the flags AND the role. Same rule as the native hook, where
  // it is `useCamera({ enabled: cameraEnabled && !ended && canPublish })`.
  useEffect(() => {
    devices?.cameraOn.set(cameraEnabled && !ended && canPublish);
  }, [devices, cameraEnabled, ended, canPublish]);

  useEffect(() => {
    devices?.micOn.set(micEnabled && !ended && canPublish);
  }, [devices, micEnabled, ended, canPublish]);

  const goLive = useCallback(async () => {
    if (!canPublish || ended) return;
    if (!reload || !camera || !mic || !token) return;
    setIsLive(true);
  }, [reload, camera, mic, token, canPublish, ended]);

  // Publication belongs to this exact room/account path. Token revocation,
  // role loss or a room switch must close the old broadcast before another
  // account's connection can be installed.
  useEffect(() => {
    if (!isLive || !canPublish || ended || !reload || !camera || !mic || !token?.path) return;
    // Broadcast no longer owns capture/encoders. Close every component together
    // on token revocation, role loss, leave and effect replay.
    const owned: { close(): void }[] = [];
    const own = <T extends { close(): void }>(resource: T): T => {
      owned.push(resource);
      return resource;
    };
    let closed = false;
    const publication = { close() {
      if (closed) return;
      closed = true;
      for (const resource of owned.reverse()) resource.close();
    } };
    try {
      const video = own(new Computed((effect) => effect.get(camera.out.source)?.video));
      const audio = own(new Computed((effect) => effect.get(mic.out.source)?.audio));
      const capture = own(new Publish.Video.Capture({ source: video }));
      const audioCapture = own(new Publish.Audio.Capture({ source: audio }));
      const broadcast = own(new Publish.Broadcast({
        origin: reload.origin,
        name: Moq.Path.from(token.path),
        enabled: true,
        display: capture.out.display,
      }));
      // Keep AVC for the existing native receiver. The SDK probes supported
      // profiles; a software VP8 diagnostic is not evidence of AVC support.
      own(new Publish.Video.Encoder("video/hd", {
        broadcast, capture, enabled: true, bandwidth: reload.bandwidth,
        config: { codec: "avc1" },
      }));
      own(new Publish.Audio.Encoder("audio", {
        broadcast, capture: audioCapture, enabled: true, bandwidth: reload.bandwidth,
      }));
    } catch (error) {
      publication.close();
      throw error;
    }
    broadcastRef.current = publication;
    return () => {
      publication.close();
      if (broadcastRef.current === publication) broadcastRef.current = null;
    };
  }, [isLive, canPublish, ended, reload, camera, mic, token?.path]);

  // State only — the effect above is what touches the device, so the gate can
  // never be bypassed by a toggle that fires before the role has landed.
  const setCameraEnabled = useCallback((on: boolean) => {
    setCameraEnabledState(on);
  }, []);
  const setMicEnabled = useCallback((on: boolean) => {
    setMicEnabledState(on);
  }, []);

  const end = useCallback(() => {
    captureLifetimeActive.current = false;
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
        error: !!error,
      })
    : viewer.state;

  return {
    state,
    error: canPublish ? error : viewer.error,
    isLive,
    localStream,
    localAudioStream,
    cameraEnabled,
    micEnabled,
    cameraError,
    microphoneError,
    captureError,
    retryCapture,
    setCameraEnabled,
    setMicEnabled,
    coPublishers,
    viewerCount: viewer.viewerCount,
    attachCanvas: viewer.attachCanvas,
    goLive,
    end,
  };
}
