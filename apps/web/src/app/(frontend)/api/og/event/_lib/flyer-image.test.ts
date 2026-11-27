import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FLYER_MAX_BYTES,
  flyerCandidateUrls,
  loadFlyerImage,
  sniffImageMime,
} from "./flyer-image.ts";

const CDN = "https://dvnt.b-cdn.net/event-image/u/2026/10/a.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

function res(body: Uint8Array, status = 200, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    arrayBuffer: async () =>
      body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  };
}

test("sniffs the formats satori can draw and rejects the rest", () => {
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(new TextEncoder().encode("GIF89a..")), "image/gif");
  assert.equal(sniffImageMime(WEBP), null);
  assert.equal(sniffImageMime(new Uint8Array()), null);
});

test("tries a 1200-wide rendition on the CDN zone, then the original", () => {
  assert.deepEqual(flyerCandidateUrls(CDN), [`${CDN}?width=1200`, CDN]);
  assert.deepEqual(flyerCandidateUrls(`${CDN}?width=64`), [`${CDN}?width=64`]);
  assert.deepEqual(flyerCandidateUrls("https://example.com/a.png"), ["https://example.com/a.png"]);
  assert.deepEqual(flyerCandidateUrls("not a url"), ["not a url"]);
});

test("returns a data URI on the first good response", async () => {
  const calls: string[] = [];
  const r = await loadFlyerImage(CDN, {
    fetchImpl: async (u) => (calls.push(u), res(PNG)),
  });
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.dataUri.startsWith("data:image/png;base64,"));
  assert.deepEqual(calls, [`${CDN}?width=1200`]);
});

test("falls back to the original when the sized fetch fails", async () => {
  const calls: string[] = [];
  const r = await loadFlyerImage(CDN, {
    fetchImpl: async (u) => {
      calls.push(u);
      if (u.includes("width=")) throw new TypeError("fetch failed");
      return res(JPEG);
    },
  });
  assert.equal(r.ok, true);
  assert.ok(r.ok && r.mime === "image/jpeg" && r.url === CDN);
  assert.equal(calls.length, 2);
});

test("retries once off the CDN zone", async () => {
  let n = 0;
  const r = await loadFlyerImage("https://example.com/a.png", {
    fetchImpl: async () => {
      n += 1;
      if (n === 1) throw new TypeError("terminated");
      return res(PNG);
    },
  });
  assert.equal(r.ok, true);
  assert.equal(n, 2);
});

test("times out a stalled transfer instead of hanging", async () => {
  const r = await loadFlyerImage("https://example.com/a.png", {
    timeoutMs: 20,
    fetchImpl: (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && /timeout after 20ms/.test(r.reason));
});

test("rejects formats satori can't decode, HTTP errors and oversize bodies", async () => {
  const webp = await loadFlyerImage(CDN, { fetchImpl: async () => res(WEBP) });
  assert.ok(!webp.ok && /unsupported format/.test(webp.reason));

  const missing = await loadFlyerImage(CDN, { fetchImpl: async () => res(new Uint8Array(), 404) });
  assert.ok(!missing.ok && /http 404/.test(missing.reason));

  const huge = await loadFlyerImage(CDN, {
    fetchImpl: async () => res(PNG, 200, { "content-length": String(FLYER_MAX_BYTES + 1) }),
  });
  assert.ok(!huge.ok && /too large/.test(huge.reason));
});
