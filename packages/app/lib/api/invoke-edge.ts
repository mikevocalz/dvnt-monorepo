/**
 * invokeEdge — thin wrapper around supabase.functions.invoke() that
 * handles the two repeated pieces of boilerplate at every call site:
 *
 *   1. Fetching the Better Auth token and attaching it as both
 *      Authorization and x-auth-token (the custom header bypasses the
 *      Supabase gateway's JWT check, per docs/engineering-contract.md).
 *   2. Normalising responses where the SDK has sometimes returned a
 *      JSON string instead of a parsed object.
 *
 * Returns `{ data, error }`. If `options.requireAuth` is false, the
 * request is sent unauthenticated (used by the guest ticket checkout
 * path which accepts requests with no session).
 */

import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";

export interface InvokeEdgeOptions {
  /** Send as an unauthed request (no Authorization header). Default: true. */
  requireAuth?: boolean;
}

export interface InvokeEdgeResult<T> {
  data?: T;
  error?: {
    message: string;
    /**
     * HTTP status, when the function actually answered. supabase-js collapses
     * every non-2xx into the same "Edge Function returned a non-2xx status
     * code" string, so without this a caller cannot tell a 401 auth race at
     * cold start from a genuine 500 — and every "is this really an error"
     * guard written against `message` is dead code.
     */
    status?: number;
  };
}

/**
 * Pull the real status + body off a supabase-js FunctionsHttpError, whose
 * `context` is the underlying Response. Best-effort: a network error has no
 * context at all.
 */
async function describeFunctionError(
  error: any,
): Promise<{ message: string; status?: number }> {
  const res: Response | undefined = error?.context;
  const status = typeof res?.status === "number" ? res.status : undefined;
  if (res && typeof res.text === "function") {
    try {
      const body = (await res.text()).trim();
      if (body) {
        try {
          const parsed = JSON.parse(body);
          const detail = parsed?.error ?? parsed?.message;
          if (typeof detail === "string" && detail) return { message: detail, status };
        } catch {
          // not JSON — fall through to the raw body
        }
        return { message: body.slice(0, 300), status };
      }
    } catch {
      // body already consumed or unreadable
    }
  }
  return { message: error?.message || "Edge function error", status };
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
      return { error: await describeFunctionError(error) };
    }
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    return { data: parsed as T };
  } catch (err: any) {
    return { error: { message: err?.message || "Network error" } };
  }
}
