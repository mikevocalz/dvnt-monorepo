/**
 * Native Lynk Live token fetchers — Fishjam WHIP/WHEP livestream tokens via the
 * `lynk-livestream-token` Edge Function (the native transport; web uses
 * `useMoqToken`). Same auth seam as the rest of the app
 * (`supabase.functions.invoke` + `requireBetterAuthToken`).
 *
 * Publish → this user's streamer token (+ their livestream room id).
 * Subscribe → a viewer token per ACTIVE publisher (one RTCView each).
 */

import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";

export interface LivestreamPublishToken {
  intent: "publish";
  token: string;
  livestreamId: string;
  peerId: string;
  role: string;
}

export interface LivestreamSubscribeStream {
  peerId: string;
  role: string;
  livestreamId: string;
  /** Viewer token for this publisher's livestream room. */
  token: string;
}

interface EdgeResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

async function invoke<T>(roomId: string, intent: "publish" | "subscribe"): Promise<T> {
  const authToken = await requireBetterAuthToken();
  const { data, error } = await supabase.functions.invoke<EdgeResponse<T>>(
    "lynk-livestream-token",
    {
      body: { roomId, intent },
      headers: { Authorization: `Bearer ${authToken}`, "x-auth-token": authToken },
    },
  );
  if (error) throw new Error(error.message || "Livestream token error");
  if (!data?.ok || !data.data) throw new Error(data?.error?.message || "Denied");
  return data.data;
}

export function fetchLivestreamPublishToken(roomId: string): Promise<LivestreamPublishToken> {
  return invoke<LivestreamPublishToken>(roomId, "publish");
}

export async function fetchLivestreamSubscribe(
  roomId: string,
): Promise<LivestreamSubscribeStream[]> {
  const data = await invoke<{ streams: LivestreamSubscribeStream[] }>(roomId, "subscribe");
  return data.streams ?? [];
}
