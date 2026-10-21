import test from "node:test";
import assert from "node:assert/strict";
import { fetchPublicEventIndex } from "./public-event-index.ts";

const event = (id: number) => ({ id, title: `Event ${id}`, status: "active", visibility: "public" });
const response = (rows: unknown, range?: string, status = 200) => new Response(JSON.stringify(rows), {
  status, headers: range ? { "content-range": range } : {},
});

test("public index fetches all server-limited pages anonymously with stable ordering", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return calls.length === 1 ? response([event(1), event(2)], "0-1/3") : response([event(3)], "2-2/3");
  };
  assert.deepEqual(await fetchPublicEventIndex("https://fixture.invalid", "anon-key", fetcher), [event(1), event(2), event(3)]);
  assert.equal(calls.length, 2);
  assert.match(calls[1]!.url, /order=id.asc&offset=2&limit=1000/);
  assert.deepEqual(calls[0]!.init, {
    headers: { apikey: "anon-key", Authorization: "Bearer anon-key", Prefer: "count=exact" },
    credentials: "omit", cache: "no-store",
  });
});

test("missing counts, truncation, changed counts, duplicate IDs and errors fail closed", async () => {
  for (const pages of [
    [response([event(1)])],
    [response([event(1)], "0-0/2"), response([], "*/2")],
    [response([event(1)], "0-0/2"), response([event(2)], "1-1/3")],
    [response([event(1)], "0-0/2"), response([event(1)], "1-1/2")],
    [response([event(1), event(2)], "0-1/1")],
    [response({ error: true }, "*/0")],
    [response([{ ...event(1), title: 123 }], "0-0/1")],
    [response([], undefined, 500)],
  ]) {
    const fetcher: typeof fetch = async () => pages.shift()!;
    await assert.rejects(fetchPublicEventIndex("https://fixture.invalid", "anon", fetcher));
  }
  await assert.rejects(fetchPublicEventIndex(undefined, undefined));
});

test("public index excludes hidden/private rows but retains cancelled explanation", async () => {
  const rows = [event(1), { ...event(2), visibility: "private" }, { ...event(3), visibility: "link_only" },
    { ...event(4), is_hidden: true }, { ...event(5), publish_at: "2999-01-01T00:00:00Z" },
    { ...event(6), status: "cancelled" }];
  const fetcher: typeof fetch = async () => response(rows, "0-5/6");
  assert.deepEqual((await fetchPublicEventIndex("https://fixture.invalid", "anon", fetcher)).map((row) => row.id), [1, 6]);
});
