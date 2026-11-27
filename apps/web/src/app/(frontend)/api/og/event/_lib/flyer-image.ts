/**
 * Flyer prefetch for the event OG card (`/api/og/event/[id]`).
 *
 * Why this exists: handing satori (next/og) a remote `<img src>` makes satori
 * fetch the full-size flyer itself, with no timeout, no retry and no format
 * check. When that fetch fails ("fetch failed" / "terminated" in the Vercel
 * runtime errors since Sep 2026) satori only logs and draws the card WITHOUT
 * the flyer, and the route still answers 200 with a year-long immutable cache
 * header, so the blank card sticks on the CDN.
 *
 * So the route loads the bytes here first: bounded time, one retry, PNG / JPEG
 * / GIF only (what satori can decode), a size cap, and an explicit "no flyer"
 * result the route can turn into a short cache instead of an immutable one.
 */

/** Hosts known to accept Bunny Optimizer transforms (`?width=`). */
const OPTIMIZER_HOSTS = new Set(["dvnt.b-cdn.net"]);

/** OG cards are 1200 wide; anything bigger is wasted bytes for satori. */
export const OG_FLYER_WIDTH = 1200;

/** Per-attempt budget. Two attempts stay well inside crawler patience. */
export const FLYER_ATTEMPT_TIMEOUT_MS = 4000;

/** Larger originals are skipped: decode + raster cost, and slow transfers. */
export const FLYER_MAX_BYTES = 8 * 1024 * 1024;

export type FlyerMime = "image/png" | "image/jpeg" | "image/gif";

export type FlyerResult =
  | { ok: true; dataUri: string; mime: FlyerMime; bytes: number; url: string }
  | { ok: false; reason: string };

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: { get(name: string): string | null };
}>;

/** Detect the formats satori can rasterize from their magic bytes. */
export function sniffImageMime(bytes: Uint8Array): FlyerMime | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "image/gif";
  }
  return null;
}

/**
 * URLs to try, in order: a 1200-wide rendition on the optimizer zone (smaller
 * transfer when the transform is on; byte-identical original when it is off),
 * then the untouched original. Off-zone or malformed URLs get one entry.
 */
export function flyerCandidateUrls(src: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    return [src];
  }
  if (!OPTIMIZER_HOSTS.has(parsed.hostname) || parsed.searchParams.has("width")) {
    return [src];
  }
  const sized = new URL(parsed.toString());
  sized.searchParams.set("width", String(OG_FLYER_WIDTH));
  return [sized.toString(), src];
}

async function attempt(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<FlyerResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      // No webp/avif: satori can't decode them, so don't invite a CDN to
      // negotiate one.
      headers: { Accept: "image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1" },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > FLYER_MAX_BYTES) {
      return { ok: false, reason: `too large (${declared} bytes)` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0) return { ok: false, reason: "empty body" };
    if (buf.byteLength > FLYER_MAX_BYTES) {
      return { ok: false, reason: `too large (${buf.byteLength} bytes)` };
    }
    const mime = sniffImageMime(buf);
    if (!mime) return { ok: false, reason: "unsupported format" };
    const dataUri = `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;
    return { ok: true, dataUri, mime, bytes: buf.byteLength, url };
  } catch (err) {
    const reason = controller.signal.aborted
      ? `timeout after ${timeoutMs}ms`
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load a flyer for the OG card. Tries each candidate URL once; a transient
 * failure on the sized rendition falls through to the original. Never throws.
 */
export async function loadFlyerImage(
  src: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<FlyerResult> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike);
  const timeoutMs = opts.timeoutMs ?? FLYER_ATTEMPT_TIMEOUT_MS;
  const reasons: string[] = [];
  for (const url of flyerCandidateUrls(src)) {
    const result = await attempt(url, fetchImpl, timeoutMs);
    if (result.ok) return result;
    reasons.push(result.reason);
  }
  // A single-candidate URL still deserves one retry for a network blip.
  if (reasons.length === 1) {
    const retry = await attempt(src, fetchImpl, timeoutMs);
    if (retry.ok) return retry;
    reasons.push(retry.reason);
  }
  return { ok: false, reason: reasons.join("; ") };
}
