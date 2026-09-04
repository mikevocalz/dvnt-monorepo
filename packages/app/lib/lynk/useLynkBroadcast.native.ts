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
  useSession,
  usePublisher,
  useCamera,
  useMicrophone,
} from "react-native-moq";
import type { CameraTrack, PublishTrack } from "react-native-moq";
import { useMoqToken } from "./useMoqToken";
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

  const session = useSession(token?.relayUrl ?? "");
  const publisher = usePublisher(session);
  // `enabled: false` stops the native capture outright — that IS camera-off on
  // this transport; there is no separate "publish black frames" mode.
  //
  // videoCodec pinned to h264 per the library's own skill: on Android an
  // unsupported encoder (usually h265) makes publishing start then silently
  // stop with NO error — moq-kit reports it as a clean stop. h264 is listed
  // by getSupportedVideoCodecs() everywhere we ship.
  const camera = useCamera({
    enabled: cameraEnabled && !ended && canPublish,
    videoCodec: "h264",
  });
  // `enabled` soft-disables capture (0.3.0 added it to MicrophoneOptions). It
  // matters beyond mute: an idle iOS capture holds the audio session in
  // `playAndRecord` and can starve other audio libraries (`insufficientPriority`).
  const mic = useMicrophone({ enabled: micEnabled && !ended && canPublish });

  const { connect, disconnect } = session;
  const { publish, stop } = publisher;

  // Connect as soon as the publish token mints, so Go Live is instant.
  useEffect(() => {
    if (!token?.relayUrl || ended) return;
    connect();
    return () => disconnect();
  }, [token?.relayUrl, ended, connect, disconnect]);

  // `publish()` snapshots its track list, so every change to the track set
  // (mic mute, camera off) has to re-publish. Keeping the list in one memo
  // means the effect below and `goLive` can never disagree about it.
  const tracks = useMemo<PublishTrack[]>(() => {
    const next: PublishTrack[] = [];
    if (cameraEnabled) next.push(camera);
    if (micEnabled) next.push(mic);
    return next;
  }, [cameraEnabled, micEnabled, camera, mic]);

  const publishedPath = useRef<string | null>(null);

  // Publish only once the session is actually connected — calling publish()
  // earlier sends the publisher straight to `error:session is not connected`
  // (it does not queue). Depending on session.state means this effect also
  // re-fires when the connection lands after Go Live was tapped, so the tap
  // never has to race the handshake.
  useEffect(() => {
    if (!isLive || !token?.path || ended) return;
    if (session.state !== "connected") return;
    publish({ path: token.path, tracks });
    publishedPath.current = token.path;
  }, [isLive, token?.path, tracks, ended, publish, session.state]);

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

  const state = deriveLynkState({
    hasToken: !!token,
    connection: connectionStatusFromSession(session.state),
    hasMedia: publisher.state === "publishing",
    ended,
    error: !!tokenError || !!publisherError,
  });

  return {
    state,
    error: tokenError ?? publisherError,
    isLive,
    cameraTrack: camera,
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
