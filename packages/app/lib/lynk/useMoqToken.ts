/**
 * useMoqToken — fetch a PATH-SCOPED, SINGLE-PURPOSE MoQ token for a Lynk room.
 *
 * Calls the `lynk-moq-token` Edge Function, which mirrors the calling feature's
 * `video_join_room` auth + private-room gate and mints a Fishjam
 * `createMoqAccess({ publishPath | subscribePath })`. A `publish` token can only
 * publish as the caller's own peer path; a `subscribe` token discovers the whole
 * room namespace and can never publish.
 *
 * NOTE on the transport: PROMPT 6 specifies `@dvnt/network apiFetch`, but every
 * Edge Function in this app is invoked through `supabase.functions.invoke` +
 * `requireBetterAuthToken()` (the calling feature included — see
 * `features/video/api.ts`). We reuse THAT seam verbatim to share a shape with the
 * calling feature rather than introduce a second, drifting auth path. Better-Auth
 * token refresh is owned by `requireBetterAuthToken`; MoQ-token refresh follows
 * the server's signed-token expiry and is owned here.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { createMoqTokenSession, MoqTokenRequestError, type MoqTokenState } from "./moq-token-session";

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
  signal?: AbortSignal,
): Promise<MoqToken> {
  const authToken = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<EdgeResponse>(
    "lynk-moq-token",
    {
      body: { roomId, intent },
      headers: { Authorization: `Bearer ${authToken}`, "x-auth-token": authToken },
      signal,
    },
  );

  if (error) {
    const status = error.context?.status;
    throw new MoqTokenRequestError(
      error.message || "Failed to fetch MoQ token",
      !status || status === 408 || status === 429 || status >= 500,
    );
  }
  if (!data?.ok || !data.data) {
    throw new MoqTokenRequestError(
      data?.error?.message || "MoQ token denied",
      !data?.error?.code || data.error.code === "internal_error",
    );
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
 * Reactive token holder that refreshes before the server's signed expiry.
 * Transient failures retry within this room/account lifetime; a separate hard
 * expiry removes media authority even when the renewal request is hung.
 */
export function useMoqToken(
  roomId: string | undefined,
  intent: MoqIntent,
  enabled = true,
): UseMoqTokenResult {
  const accountKey = useAuthStore((s) => JSON.stringify([s.user?.id ?? null, s.user?.authId ?? null]));
  const [accountEpoch, setAccountEpoch] = useState(0);
  const scope = JSON.stringify([roomId, intent, accountKey, accountEpoch, enabled]);
  const [state, setState] = useState<MoqTokenState<MoqToken> & { scope: string }>({
    scope, token: null, loading: false, error: null,
  });
  const sessionRef = useRef<ReturnType<typeof createMoqTokenSession<MoqToken>> | null>(null);
  const refresh = useCallback(() => sessionRef.current?.refresh() ?? Promise.resolve(null), []);

  useEffect(() => {
    if (!enabled || !roomId) return;
    const session = createMoqTokenSession({
      fetchToken: (signal) => fetchMoqToken(roomId, intent, signal),
      onChange: (next) => setState({ ...next, scope }),
    });
    sessionRef.current = session;
    // Invalidate synchronously on account changes, even if A → B → A happens
    // before React commits the next effect. No old account's token can land.
    const unsubscribe = useAuthStore.subscribe((s) => {
      const nextOwner = JSON.stringify([s.user?.id ?? null, s.user?.authId ?? null]);
      if (nextOwner !== accountKey) {
        session.stop();
        setAccountEpoch((epoch) => epoch + 1);
      }
    });
    void session.refresh();
    return () => {
      unsubscribe();
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [enabled, roomId, intent, accountKey, scope]);

  // Hide the previous room/account immediately, before effect cleanup runs.
  return state.scope === scope && enabled
    ? { token: state.token, loading: state.loading, error: state.error, refresh }
    : { token: null, loading: false, error: null, refresh };
}
