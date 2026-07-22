import { NextRequest, NextResponse } from "next/server";

/**
 * A9 server-side Sentry proxy. The ONLY place the Sentry internal-integration
 * token lives — server env `SENTRY_INTERNAL_TOKEN`, never NEXT_PUBLIC_, so
 * nothing token-shaped can reach a client bundle. GET-only, path-allowlisted,
 * ~60s in-memory cache to stay far inside Sentry rate limits. Responses are
 * whatever trimmed aggregate the dashboard asked for — the client never sees
 * raw event payloads because the fetchers only request aggregates.
 */

const SENTRY_BASE = "https://sentry.io/api/0";
const ORG = "5th-galaxy-studios";

// GET-only allowlist: sessions/issues/monitors/events reads for this org.
const ALLOWED = [
  new RegExp(`^/organizations/${ORG}/(sessions|issues|monitors|events|releases)/`),
  new RegExp(`^/projects/${ORG}/[a-z0-9-]+/(issues|releases)/$`),
];

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; status: number; body: unknown }>();

export async function GET(req: NextRequest) {
  const token = process.env.SENTRY_INTERNAL_TOKEN;
  if (!token) {
    return NextResponse.json(
      { configured: false, error: "SENTRY_INTERNAL_TOKEN not set" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const path = searchParams.get("path") || "";
  if (!ALLOWED.some((re) => re.test(path))) {
    return NextResponse.json({ error: "path not allowed" }, { status: 400 });
  }

  const upstream = new URL(`${SENTRY_BASE}${path}`);
  searchParams.forEach((value, key) => {
    if (key !== "path") upstream.searchParams.append(key, value);
  });

  const cacheKey = upstream.toString();
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.body as object, { status: hit.status });
  }

  const res = await fetch(cacheKey, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  cache.set(cacheKey, { at: Date.now(), status: res.status, body });
  return NextResponse.json(body, { status: res.status });
}
