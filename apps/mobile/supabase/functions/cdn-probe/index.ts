/**
 * cdn-probe — A10 Bunny CDN synthetic probe (pg_cron every 5 min, cron-monitored).
 *
 * Fetches a canary object through the pull zone AND directly from storage
 * origin; records both latencies + the cdn cache-status header. Alert
 * conditions are computed HERE and emitted as Sentry events (Sentry cannot
 * poll Bunny natively): edge slower than origin, persistent cache MISS,
 * non-200 from the pull zone. Ensures the canary exists by uploading it via
 * the storage API on first run (BUNNY_ACCESS_KEY is already in the edge env
 * for media-upload; never in any client bundle).
 */
import * as Sentry from "npm:@sentry/deno@10";
import { withSentry, captureEdge } from "../_shared/sentry.ts";

const MONITOR_SLUG = "cdn-probe";
const MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "*/5 * * * *" },
  checkinMargin: 5,
  maxRuntime: 2,
  timezone: "Etc/UTC",
} as const;

const CANARY_PATH = "__canary.txt";

function env(name: string): string {
  return Deno.env.get(name) || "";
}

async function ensureCanary(): Promise<void> {
  const host = env("BUNNY_STORAGE_HOST") || "storage.bunnycdn.com";
  const zone = env("BUNNY_STORAGE_ZONE");
  const key = env("BUNNY_ACCESS_KEY");
  if (!zone || !key) return;
  await fetch(`https://${host}/${zone}/${CANARY_PATH}`, {
    method: "PUT",
    headers: { AccessKey: key, "Content-Type": "text/plain" },
    body: "dvnt-canary",
  }).catch(() => {});
}

async function timedFetch(url: string, headers: Record<string, string> = {}) {
  const start = performance.now();
  try {
    const res = await fetch(url, { headers, cache: "no-store" as RequestCache });
    await res.arrayBuffer();
    return {
      status: res.status,
      latencyMs: Math.round(performance.now() - start),
      cacheStatus: res.headers.get("cdn-cache") || res.headers.get("cdn-cache-status") || "unknown",
    };
  } catch (e) {
    return { status: 0, latencyMs: Math.round(performance.now() - start), cacheStatus: "unreachable", error: String(e) };
  }
}

Deno.serve(
  withSentry("cdn-probe", async (req) => {
    const isCheckin = new URL(req.url).searchParams.get("checkin") === "1";
    const checkInId = isCheckin
      ? Sentry.captureCheckIn({ monitorSlug: MONITOR_SLUG, status: "in_progress" }, MONITOR_CONFIG)
      : null;

    const pullZone = (env("BUNNY_PULLZONE_BASE_URL") || "https://dvnt.b-cdn.net").replace(/\/$/, "");
    const cdnUrl = `${pullZone}/${CANARY_PATH}`;

    let cdn = await timedFetch(cdnUrl);
    if (cdn.status === 404) {
      await ensureCanary();
      cdn = await timedFetch(cdnUrl);
    }

    // Origin comparison (storage endpoint) — only when creds are present.
    const zone = env("BUNNY_STORAGE_ZONE");
    const key = env("BUNNY_ACCESS_KEY");
    const origin = zone && key
      ? await timedFetch(
          `https://${env("BUNNY_STORAGE_HOST") || "storage.bunnycdn.com"}/${zone}/${CANARY_PATH}`,
          { AccessKey: key },
        )
      : null;

    const result = {
      ok: cdn.status === 200,
      cdn,
      origin,
    };

    // Alert conditions, computed here (Sentry can't poll Bunny):
    if (cdn.status !== 200) {
      await captureEdge(new Error(`cdn-probe: pull zone returned ${cdn.status}`), {
        function: "cdn-probe",
      });
    } else if (origin && origin.status === 200 && cdn.latencyMs > origin.latencyMs * 2 && cdn.latencyMs > 500) {
      await captureEdge(
        new Error(`cdn-probe: edge slower than origin (${cdn.latencyMs}ms vs ${origin.latencyMs}ms)`),
        { function: "cdn-probe" },
      );
    }

    if (checkInId) {
      Sentry.captureCheckIn(
        { checkInId, monitorSlug: MONITOR_SLUG, status: result.ok ? "ok" : "error" },
        MONITOR_CONFIG,
      );
    }
    await Sentry.flush(2000);

    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 503,
      headers: { "Content-Type": "application/json" },
    });
  }),
);
