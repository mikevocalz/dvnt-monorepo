/**
 * useLynkBroadcast (NATIVE) — TRUE native publish via Fishjam WHIP livestream
 * (`@fishjam-cloud/react-native-client` `useLivestreamStreamer` + camera/mic).
 * No WebView: the host's phone camera publishes a real native `MediaStream`, and
 * co-publishers (cohost/speakers) are watched through the same livestream
 * subscribe path the viewer uses.
 *
 * MUST run under `<FishjamProvider>` (the Lynk native screen wraps it). Teardown
 * on `end()` stops publishing + releases the camera (privacy).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useCamera,
  useMicrophone,
  useInitializeDevices,
  useLivestreamStreamer,
} from "@fishjam-cloud/react-native-client";
import { deriveLynkState } from "./lynkState";
import type { LynkState } from "./lynkState";
import {
  fetchLivestreamPublishToken,
  fetchLivestreamSubscribe,
  type LivestreamSubscribeStream,
} from "./livestreamToken";

const POLL_MS = 4000;

export interface UseLynkBroadcastNativeResult {
  state: LynkState;
  error: string | null;
  isLive: boolean;
  /** Local camera preview MediaStream (RN). */
  localStream: unknown | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  setCameraEnabled: (on: boolean) => void;
  setMicEnabled: (on: boolean) => void;
  /** Co-publishers (cohost/speakers) + viewer tokens to render their tiles. */
  coPublishers: LivestreamSubscribeStream[];
  viewerCount: number;
  goLive: () => Promise<void>;
  end: () => void;
  publishUnsupported: false;
}

export function useLynkBroadcast(
  roomId: string | undefined,
): UseLynkBroadcastNativeResult {
  const { initializeDevices } = useInitializeDevices();
  const { cameraStream, toggleCamera, startCamera, stopCamera, isCameraOn } = useCamera();
  const { microphoneStream } = useMicrophone();
  const streamer = useLivestreamStreamer();

  const [isLive, setIsLive] = useState(false);
  const [micEnabled, setMicEnabledState] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [coPublishers, setCoPublishers] = useState<LivestreamSubscribeStream[]>([]);
  const selfPeerId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const alive = useRef(true);

  // Bring up camera + mic on mount so the preview is ready before Go Live.
  useEffect(() => {
    void initializeDevices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll co-publishers (exclude self).
  useEffect(() => {
    alive.current = true;
    const poll = async () => {
      if (!roomId) return;
      try {
        const streams = await fetchLivestreamSubscribe(roomId);
        if (alive.current)
          setCoPublishers(streams.filter((s) => s.peerId !== selfPeerId.current));
      } catch {
        /* transient */
      }
    };
    void poll();
    timer.current = setInterval(() => void poll(), POLL_MS);
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, [roomId]);

  const goLive = useCallback(async () => {
    if (!roomId || isLive) return;
    try {
      if (!isCameraOn) await startCamera();
      const { token, peerId } = await fetchLivestreamPublishToken(roomId);
      selfPeerId.current = peerId;
      if (!cameraStream) {
        setError("Camera is not ready yet — try again.");
        return;
      }
      await streamer.connect({
        inputs: { video: cameraStream, audio: microphoneStream ?? null },
        token,
      });
      setIsLive(true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to go live");
    }
  }, [roomId, isLive, isCameraOn, startCamera, cameraStream, microphoneStream, streamer]);

  const setCameraEnabled = useCallback(
    (_on: boolean) => {
      void toggleCamera();
    },
    [toggleCamera],
  );
  const setMicEnabled = useCallback((on: boolean) => {
    setMicEnabledState(on);
    // Mic mute on native livestream: stop including audio on next (re)connect;
    // for v1 we toggle the flag (full hot-mute is a follow-on).
  }, []);

  const end = useCallback(() => {
    setEnded(true);
    setIsLive(false);
    try {
      streamer.disconnect();
    } catch {
      /* ignore */
    }
    stopCamera();
  }, [streamer, stopCamera]);

  useEffect(() => () => end(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const state = deriveLynkState({
    hasToken: true,
    connection: streamer.isConnected ? "connected" : "connecting",
    hasMedia: isLive && streamer.isConnected,
    ended,
    error: !!error || !!streamer.error,
  });

  return {
    state,
    error: error ?? (streamer.error ? String(streamer.error) : null),
    isLive,
    localStream: cameraStream ?? null,
    cameraEnabled: isCameraOn,
    micEnabled,
    setCameraEnabled,
    setMicEnabled,
    coPublishers,
    viewerCount: 0,
    goLive,
    end,
    publishUnsupported: false,
  };
}
