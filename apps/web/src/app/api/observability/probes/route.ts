import { NextResponse } from "next/server";

/**
 * A9/A10: DB + CDN health for the admin cards, fanned out to the PUBLIC probe
 * functions (no credentials involved — the probes serve no secrets). 30s
 * in-memory cache; the probes themselves run on pg_cron and are cron-monitored
 * in Sentry, this endpoint is just the admin view of "right now".
 */

const FN_BASE = "https://npfjanxturvmjyevoyfo.supabase.co/functions/v1";
const CACHE_TTL_MS = 30_000;

let cached: { at: number; body: unknown } | null = null;

async function probe(path: string) {
  try {
    const res = await fetch(`${FN_BASE}/${path}`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    return await res.json();
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function GET() {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json(cached.body as object);
  }
  const [db, cdn] = await Promise.all([probe("db-health"), probe("cdn-probe")]);
  const body = { at: new Date().toISOString(), db, cdn };
  cached = { at: Date.now(), body };
  return NextResponse.json(body);
}
