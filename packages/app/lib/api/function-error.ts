// No imports: safe to pull into any bundle, including isolated test bundles.

/**
 * Pull the real status + body off a supabase-js FunctionsHttpError, whose
 * `context` is the underlying Response. Best-effort: a network error has no
 * context at all.
 */
export async function describeFunctionError(
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
