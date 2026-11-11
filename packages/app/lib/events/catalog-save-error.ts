/** A lost response can follow a committed INSERT. Do not blindly create again. */
export function catalogSaveNeedsReload(error: unknown): boolean {
  const seen = new Set<unknown>();
  let candidate = error;
  while (candidate && typeof candidate === "object" && !seen.has(candidate)) {
    seen.add(candidate);
    const value = candidate as { name?: string; message?: string; cause?: unknown };
    if (value.name === "AbortError" || value.name === "TimeoutError" ||
        /timed? ?out|timeout|network|failed to fetch|fetch failed|stalled at|not confirmed/i.test(value.message ?? "")) return true;
    candidate = value.cause;
  }
  return false;
}
