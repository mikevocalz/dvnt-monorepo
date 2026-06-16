/**
 * invokeEdge — thin wrapper around supabase.functions.invoke() that
 * handles the two repeated pieces of boilerplate at every call site:
 *
 *   1. Fetching the Better Auth token and attaching it as both
 *      Authorization and x-auth-token (the custom header bypasses the
 *      Supabase gateway's JWT check, per CLAUDE.md).
 *   2. Normalising responses where the SDK has sometimes returned a
 *      JSON string instead of a parsed object.
 *
 * Returns `{ data, error }`. If `options.requireAuth` is false, the
 * request is sent unauthenticated (used by the guest ticket checkout
 * path which accepts requests with no session).
 */

import { supabase } from "@/lib/supabase/client";
import { requireBetterAuthToken } from "@/lib/auth/identity";

export interface InvokeEdgeOptions {
  /** Send as an unauthed request (no Authorization header). Default: true. */
  requireAuth?: boolean;
}

export interface InvokeEdgeResult<T> {
  data?: T;
  error?: { message: string };
}

export async function invokeEdge<T = any>(
  fnName: string,
  body: any,
  options: InvokeEdgeOptions = {},
): Promise<InvokeEdgeResult<T>> {
  const { requireAuth = true } = options;
  try {
    let headers: Record<string, string> | undefined;
    if (requireAuth) {
      const token = await requireBetterAuthToken();
      if (!token) return { error: { message: "Not authenticated" } };
      headers = {
        Authorization: `Bearer ${token}`,
        "x-auth-token": token,
      };
    }

    const { data, error } = await supabase.functions.invoke(fnName, {
      body,
      headers,
    });
    if (error) {
      return { error: { message: error.message || "Edge function error" } };
    }
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return { data: parsed as T };
  } catch (err: any) {
    return { error: { message: err?.message || "Network error" } };
  }
}
