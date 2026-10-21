import { isPublishedEvent, type DiscoveryEvent } from "./event-discovery.ts";

const PAGE_SIZE = 1000;

/** Public metadata only: never reuse a viewer's token or a private event cache. */
export async function fetchPublicEventIndex(
  url: string | undefined,
  anonKey: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<DiscoveryEvent[]> {
  if (!url || !anonKey) throw new Error("Event index is unavailable");
  const rows: DiscoveryEvent[] = [];
  let total: number | undefined;
  do {
    const response = await fetcher(
      `${url}/rest/v1/events?select=id,title,status,created_at,visibility,is_hidden,publish_at&order=id.asc&offset=${rows.length}&limit=${PAGE_SIZE}`,
      {
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          Prefer: "count=exact",
        },
        credentials: "omit",
        cache: "no-store",
      },
    );
    if (!response.ok) throw new Error("Event index request failed");
    const count = response.headers.get("content-range")?.match(/\/(\d+)$/);
    const nextTotal = count ? Number(count[1]) : NaN;
    if (!Number.isSafeInteger(nextTotal) || (total !== undefined && nextTotal !== total)) {
      throw new Error("Event index is incomplete");
    }
    total = nextTotal;
    const page: unknown = await response.json();
    if (!Array.isArray(page) || (page.length === 0 && rows.length < total)) {
      throw new Error("Event index is incomplete");
    }
    for (const row of page) {
      if (!row || typeof row !== "object" || !/^[1-9]\d*$/.test(String(row.id)) ||
          !Number.isSafeInteger(Number(row.id)) ||
          ["title", "status", "created_at", "visibility", "publish_at"].some((key) => row[key] != null && typeof row[key] !== "string") ||
          (row.is_hidden != null && typeof row.is_hidden !== "boolean") ||
          (rows.length > 0 && Number(row.id) <= Number(rows[rows.length - 1]!.id))) {
        throw new Error("Event index is invalid");
      }
      rows.push(row);
    }
    if (rows.length > total) throw new Error("Event index is incomplete");
  } while (rows.length < total);
  // Keep cancelled rows for the detail screen's unavailable-event explanation.
  return rows.filter((row) =>
    (row.visibility == null || row.visibility === "public") && isPublishedEvent(row),
  );
}
