/**
 * useMoqToken — fetch a PATH-SCOPED, SINGLE-PURPOSE MoQ token for a Lynk room.
 *
 * Calls the `lynk-moq-token` Edge Function, which mirrors the calling feature's
 * `video_join_room` auth + private-room gate and mints a Fishjam
 * `createMoqToken({ publishPath | subscribePath })`. A `publish` token can only
 * publish as the caller's own peer path; a `subscribe` token discovers the whole
 * room namespace and can never publish.
 *
 * NOTE on the transport: PROMPT 6 specifies `@dvnt/network apiFetch`, but every
 * Edge Function in this app is invoked through `supabase.functions.invoke` +
 * `requireBetterAuthToken()` (the calling feature included — see
 * `src/video/api.ts`). We reuse THAT seam verbatim to share a shape with the
 * calling feature rather than introduce a second, drifting auth path. Better-Auth
 * token refresh is owned by `requireBetterAuthToken`; MoQ-token refresh (on the
 * 1h expiry) is owned here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";

export type MoqIntent = "publish" | "subscribe";

export interface MoqToken {
  token: string;
  /** Fully-built relay URL incl. `?jwt=` — `https://relay.fishjam.io/${id}?jwt=`. */
  relayUrl: string;
  fishjamId: string;
  intent: MoqIntent;
  /** Effective room role the server resolved for this user. */
  role: string;
  /** This caller's path-safe peer id (publishers publish under it). */
  peerId: string;
  /** Publish: the caller's own path. Subscribe: the room namespace. */
  path: string;
  /** The room namespace — viewers subscribe here to discover all publishers. */
  namespace: string;
  expiresAt: string;
}

interface EdgeResponse {
  ok: boolean;
  data?: MoqToken;
  error?: { code: string; message: string; detail?: Record<string, unknown> };
}

/** Imperative fetch — used by the transport hooks and re-auth on expiry. */
export async function fetchMoqToken(
  roomId: string,
  intent: MoqIntent,
): Promise<MoqToken> {
  const authToken = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<EdgeResponse>(
    "lynk-moq-token",
    {
      body: { roomId, intent },
      headers: { Authorization: `Bearer ${authToken}`, "x-auth-token": authToken },
    },
  );

  if (error) {
    throw new Error(error.message || "Failed to fetch MoQ token");
  }
  if (!data?.ok || !data.data) {
    throw new Error(data?.error?.message || "MoQ token denied");
  }
  return data.data;
}

export interface UseMoqTokenResult {
  token: MoqToken | null;
  loading: boolean;
  error: string | null;
  /** Re-mint immediately (used on transport drop / expiry). */
  refresh: () => Promise<MoqToken | null>;
}

/**
 * Reactive token holder that auto-refreshes shortly before the 1h expiry, the
 * same cadence as the calling feature's `video_refresh_token`.
 */
export function useMoqToken(
  roomId: string | undefined,
  intent: MoqIntent,
  enabled = true,
): UseMoqTokenResult {
  const [token, setToken] = useState<MoqToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<MoqToken | null> => {
    if (!roomId) return null;
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMoqToken(roomId, intent);
      if (!mounted.current) return next;
      setToken(next);
      // Schedule a refresh 60s before expiry.
      if (timer.current) clearTimeout(timer.current);
      const ms = Math.max(
        15_000,
        new Date(next.expiresAt).getTime() - Date.now() - 60_000,
      );
      timer.current = setTimeout(() => void refresh(), ms);
      return next;
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Token error");
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [roomId, intent]);

  useEffect(() => {
    mounted.current = true;
    if (enabled && roomId) void refresh();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, roomId, refresh]);

  return { token, loading, error, refresh };
}
