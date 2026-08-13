/**
 * useLynkViewer (NATIVE) — subscribe to a Lynk room namespace over MoQ, using
 * `react-native-moq` (true native QUIC + hardware decode, no WebView).
 *
 * WS-3: this replaces the Fishjam WHIP/WHEP livestream implementation. The
 * shape of the change is that discovery stops being a 4s poll of
 * `lynk-livestream-token` and becomes reactive, exactly like the web hook:
 *   - subscribe token (namespace-scoped) ← `lynk-moq-token`
 *   - `useSession(relayUrl)` → connect once the token mints
 *   - `useBroadcasts(session, namespace)` → one `BroadcastInfo` per live
 *     publisher, each carrying a `player` the screen binds to `<VideoView>`
 *   - mute/volume are applied per player
 *
 * A viewer NEVER publishes — the token is subscribe-only and there is no
 * publish affordance here. Teardown on `leave()` (call from
 * unmount/leave/background) is a privacy requirement, not a nicety.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession, useBroadcasts } from "react-native-moq";
import type { BroadcastInfo, SessionState } from "react-native-moq";
import { useMoqToken } from "./useMoqToken";
import { deriveLynkState, type MoqConnectionStatus } from "./lynkState";
import type { LynkPublisher, LynkViewerBase } from "./types";

/** A discovered publisher plus the native player that renders it. */
export interface NativeLynkPublisher extends LynkPublisher {
  broadcast: BroadcastInfo;
}

export interface UseLynkViewerNativeResult extends LynkViewerBase {
  publishers: NativeLynkPublisher[];
}

/**
 * `react-native-moq` session states → the transport-agnostic status
 * `deriveLynkState` speaks. `idle` is "not started yet" (undefined), and both
 * `closed` and `error:*` are a drop we expect the session to recover from.
 */
export function connectionStatusFromSession(
  state: SessionState,
): MoqConnectionStatus | undefined {
  if (state === "idle") return undefined;
  if (state === "connecting") return "connecting";
  if (state === "connected") return "connected";
  return "disconnected";
}

export function useLynkViewer(
  roomId: string | undefined,
): UseLynkViewerNativeResult {
  const { token, error: tokenError } = useMoqToken(roomId, "subscribe", !!roomId);
  const session = useSession(token?.relayUrl ?? "");

  const [muted, setMutedState] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [ended, setEnded] = useState(false);

  const namespace = token?.namespace ?? (roomId ? `lynk/${roomId}` : "");
  const { connect, disconnect } = session;

  // Connect once the relay URL exists. `session.url` is read at connect() time,
  // so a token refresh that changes the URL reconnects on the new one.
  useEffect(() => {
    if (!token?.relayUrl || ended) return;
    connect();
    return () => disconnect();
  }, [token?.relayUrl, ended, connect, disconnect]);

  const broadcasts = useBroadcasts(session, namespace);

  const publishers = useMemo<NativeLynkPublisher[]>(
    () =>
      broadcasts.map((b) => ({
        path: b.path,
        peerId: b.path.slice(b.path.lastIndexOf("/") + 1),
        broadcast: b,
      })),
    [broadcasts],
  );

  // Volume is per-player, so re-apply whenever the set of players changes.
  useEffect(() => {
    for (const b of broadcasts) b.player.setVolume(muted ? 0 : volume);
  }, [broadcasts, muted, volume]);

  const setMuted = useCallback((m: boolean) => setMutedState(m), []);
  const setVolume = useCallback(
    (v: number) => setVolumeState(Math.max(0, Math.min(1, v))),
    [],
  );

  const leave = useCallback(() => {
    setEnded(true);
    disconnect();
  }, [disconnect]);

  const state = deriveLynkState({
    hasToken: !!token,
    connection: connectionStatusFromSession(session.state),
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
    leave,
  };
}
