/**
 * useLynkBroadcast (NATIVE) — publish camera + mic to a Lynk room over MoQ via
 * `react-native-moq` (true native QUIC + hardware encode, no WebView).
 *
 * WS-3: replaces the Fishjam WHIP livestream publish path, so native and web
 * now speak the same transport and interop against each other.
 *   - publish token (own peer path) ← `lynk-moq-token` (intent: "publish")
 *   - `useSession(relayUrl)` + `usePublisher(session)`
 *   - `useCamera()` / `useMicrophone()` → `publish({ path, tracks })`
 *   - co-publishers are discovered by composing `useLynkViewer` (a SEPARATE,
 *     subscribe-scoped connection — MoQ tokens are single-purpose, so a
 *     publisher needs both a publish token to send and a subscribe token to
 *     watch others). Same composition the web hook uses.
 *
 * Unlike web there is no `MediaStream`: the local preview is the native
 * `<PublisherView camera={cameraTrack} />`, so this hook exposes `cameraTrack`
 * rather than `localStream`.
 *
 * Teardown on `end()` stops publishing and releases the camera — a stream that
 * keeps publishing after you navigate away is a privacy incident, so the screen
 * MUST call `end()` on unmount/leave/background.
 *
 * `canPublish` exists so a screen with BOTH kinds of member (a Sneaky Lynk room:
 * speakers publish, listeners only watch) can hold ONE hook unconditionally.
 * With it false no publish token is minted — `lynk-moq-token` denies `publish`
 * for a non-speaker role, and an unconditional request would put every listener
 * into `error` — the camera/mic never start, and the hook degrades to the
 * composed viewer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  usePublisher,
  useCamera,
  useMicrophone,
} from "react-native-moq";
import type { CameraTrack, PublishTrack } from "react-native-moq";
import { useMoqToken } from "./useMoqToken";
import { useNativeMoqSession } from "./useNativeMoqSession";
import {
  useLynkViewer,
  connectionStatusFromSession,
  type NativeLynkPublisher,
} from "./useLynkViewer.native";
import { deriveLynkState } from "./lynkState";
import type { LynkBroadcastBase } from "./types";

export interface UseLynkBroadcastNativeResult extends LynkBroadcastBase {
  /** Local camera track — bind to `<PublisherView camera={...} />` for preview. */
  cameraTrack: CameraTrack;
  /** Local device failures are recoverable without disconnecting reception. */
  cameraError: string | null;
  microphoneError: string | null;
  captureError: string | null;
  /** Explicit user retry only; ordinary desired-state reconciliation never retries. */
  retryCapture: () => void;
  /** Each co-publisher carries the native player its tile renders. */
  coPublishers: NativeLynkPublisher[];
}

export function useLynkBroadcast(
  roomId: string | undefined,
  canPublish = true,
): UseLynkBroadcastNativeResult {
  const { token, error: tokenError } = useMoqToken(
    roomId,
    "publish",
    !!roomId && canPublish,
  );
  // Compose the viewer for co-publisher discovery (separate subscribe token).
  const viewer = useLynkViewer(roomId);

  const [isLive, setIsLive] = useState(false);
  const [cameraEnabled, setCameraEnabledState] = useState(true);
  const [micEnabled, setMicEnabledState] = useState(true);
  const [ended, setEnded] = useState(false);
  const [retryCamera, setRetryCamera] = useState(false);
  const [retryMicrophone, setRetryMicrophone] = useState(false);

  // A new admission (including effect replay) owns a fresh transport lifetime.
  // Explicit end() remains terminal until this room lifetime is replaced.
  useEffect(() => {
    setEnded(false);
    setIsLive(false);
  }, [roomId]);

  const session = useNativeMoqSession(token?.relayUrl, !ended && canPublish);
  const publisher = usePublisher(session);
  // `enabled: false` stops the native capture outright — that IS camera-off on
  // this transport; there is no separate "publish black frames" mode.
  //
  // videoCodec pinned to h264 per the library's own skill: on Android an
  // unsupported encoder (usually h265) makes publishing start then silently
  // stop with NO error — moq-kit reports it as a clean stop. h264 is listed
  // by getSupportedVideoCodecs() everywhere we ship.
  const camera = useCamera({
    enabled: cameraEnabled && !retryCamera && !ended && canPublish,
    videoCodec: "h264",
  });
  // `enabled` soft-disables capture (0.3.0 added it to MicrophoneOptions). It
  // matters beyond mute: an idle iOS capture holds the audio session in
  // `playAndRecord` and can starve other audio libraries (`insufficientPriority`).
  const mic = useMicrophone({ enabled: micEnabled && !retryMicrophone && !ended && canPublish });

  // The SDK starts capture when enabled changes. A retry must commit a disabled
  // render first so its cleanup releases the old capture before restarting it.
  // Never retry from reconciliation/timers: denied permission needs user action.
  useEffect(() => {
    if (retryCamera) setRetryCamera(false);
    if (retryMicrophone) setRetryMicrophone(false);
  }, [retryCamera, retryMicrophone]);

  const cameraError = cameraEnabled && !ended && canPublish && (camera.state.startsWith("error:") || (camera.state === "idle" && camera.lastError))
    ? camera.lastError || camera.state.slice("error:".length) || "Camera unavailable"
    : null;
  const microphoneError = micEnabled && !ended && canPublish && (mic.state.startsWith("error:") || (mic.state === "idle" && mic.lastError))
    ? mic.lastError || mic.state.slice("error:".length) || "Microphone unavailable"
    : null;
  const captureError = microphoneError ?? cameraError;
  const retryCapture = useCallback(() => {
    if (cameraError) setRetryCamera(true);
    if (microphoneError) setRetryMicrophone(true);
  }, [cameraError, microphoneError]);

  const { disconnect } = session;
  const { publish, stop } = publisher;

  // `publish()` snapshots its track list, so every change to the track set
  // (mic mute, camera off) has to re-publish. Keeping the list in one memo
  // means the effect below and `goLive` can never disagree about it.
  // A failed/idle capture is not a publishable track. Passing it to the native
  // publisher makes waitForMicrophone/waitForCameraCapture throw and turns a
  // recoverable device problem into a transport error. Keep healthy tracks and
  // the receiving connection alive, including while the failed device retries.
  const publishCamera = cameraEnabled && !retryCamera && camera.state === "active" ? camera : null;
  const publishMic = micEnabled && !retryMicrophone && mic.state === "active" ? mic : null;
  const tracks = useMemo<PublishTrack[]>(() => {
    const next: PublishTrack[] = [];
    if (publishCamera) next.push(publishCamera);
    if (publishMic) next.push(publishMic);
    return next;
  }, [publishCamera, publishMic]);

  const publishedPath = useRef<string | null>(null);

  // Publish only once the session is actually connected — calling publish()
  // earlier sends the publisher straight to `error:session is not connected`
  // (it does not queue). Depending on session.state means this effect also
  // re-fires when the connection lands after Go Live was tapped, so the tap
  // never has to race the handshake.
  useEffect(() => {
    if (!isLive || !token?.path || ended || !canPublish) return;
    if (session.state !== "connected") return;
    publish({ path: token.path, tracks });
    publishedPath.current = token.path;
    return () => {
      stop();
      publishedPath.current = null;
    };
  }, [isLive, token?.path, tracks, ended, canPublish, publish, stop, session.state]);

  const goLive = useCallback(async () => {
    if (!token || isLive || !canPublish) return;
    setIsLive(true);
  }, [token, isLive, canPublish]);

  const setCameraEnabled = useCallback(
    (on: boolean) => setCameraEnabledState(on),
    [],
  );
  const setMicEnabled = useCallback(
    (on: boolean) => setMicEnabledState(on),
    [],
  );

  const end = useCallback(() => {
    setEnded(true);
    setIsLive(false);
    publishedPath.current = null;
    stop();
    disconnect();
    viewer.leave();
  }, [stop, disconnect, viewer.leave]); // eslint-disable-line react-hooks/exhaustive-deps

  // Privacy teardown: stop publishing on unmount.
  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Co-publishers = everyone discovered except ourselves.
  const coPublishers = useMemo(
    () => viewer.publishers.filter((p) => p.peerId !== token?.peerId),
    [viewer.publishers, token?.peerId],
  );

  const publisherError = publisher.state.startsWith("error:")
    ? publisher.lastError || publisher.state.slice("error:".length)
    : null;

  // The native publisher can finish an older publish with the same capture
  // failure after that track was removed. Only these known device failures are
  // recoverable here; an independent relay/auth/publisher error remains fatal.
  const knownCapturePublisherError = !!publisherError && (
    (!!cameraError && (publisherError === cameraError || publisherError === "camera capture not started")) ||
    (!!microphoneError && (publisherError === microphoneError || publisherError === "microphone capture not started"))
  );
  const rememberedCaptureFailure = useRef<{ roomId: string | undefined; error: string } | null>(null);
  if (!canPublish || ended || !publisherError || rememberedCaptureFailure.current?.roomId !== roomId) {
    rememberedCaptureFailure.current = null;
  }
  if (knownCapturePublisherError && publisherError) {
    rememberedCaptureFailure.current = { roomId, error: publisherError };
  } else if (rememberedCaptureFailure.current?.error !== publisherError) {
    rememberedCaptureFailure.current = null;
  }
  // Starting capture clears the SDK's lastError before active tracks can be
  // republished. Remember ONLY the already-attributed publisher error through
  // that gap; a new/different error or successful publish clears the attribution.
  const capturePublisherError = !!publisherError && rememberedCaptureFailure.current?.error === publisherError;
  const transportError = tokenError ?? (capturePublisherError ? null : publisherError);

  // A listener requests NO publish token (`canPublish` false), so the publish
  // lifecycle has nothing to report and `deriveLynkState` would sit at
  // `requesting-token` forever — the screen would never leave "Connecting…".
  // Their real state is the composed viewer's. Mirrors the web sibling.
  const state = canPublish
    ? deriveLynkState({
        hasToken: !!token,
        connection: connectionStatusFromSession(session.state),
        hasMedia: publisher.state === "publishing" || !!captureError || capturePublisherError,
        ended,
        error: !!transportError,
      })
    : viewer.state;

  return {
    state,
    error: canPublish ? transportError : viewer.error,
    isLive,
    cameraTrack: camera,
    cameraError,
    microphoneError,
    captureError,
    retryCapture,
    cameraEnabled,
    micEnabled,
    setCameraEnabled,
    setMicEnabled,
    coPublishers,
    viewerCount: viewer.viewerCount,
    goLive,
    end,
  };
}
