import { NextResponse } from "next/server";
import { getPublicWebBackend } from "@/lib/public-web-backend";

/**
 * A9/A10: DB + CDN health for the admin cards, fanned out to the PUBLIC probe
 * functions (no credentials involved — the probes serve no secrets). 30s
 * in-memory cache; the probes themselves run on pg_cron and are cron-monitored
 * in Sentry, this endpoint is just the admin view of "right now".
 */

const CACHE_TTL_MS = 30_000;

let cached: { base: string; at: number; body: unknown } | null = null;

async function probe(base: string, path: string) {
  try {
    const res = await fetch(`${base}/functions/v1/${path}`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "error",
    });
    return await res.json();
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function GET() {
  let base: string;
  try {
    base = getPublicWebBackend().supabaseUrl;
  } catch {
    return NextResponse.json({ error: "Public web backend configuration is unavailable" }, { status: 503 });
  }
  if (cached && cached.base === base && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body as object);
  }
  const [db, cdn] = await Promise.all([probe(base, "db-health"), probe(base, "cdn-probe")]);
  const body = { at: new Date().toISOString(), db, cdn };
  cached = { base, at: Date.now(), body };
  return NextResponse.json(body);
}
