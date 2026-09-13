/**
 * Sentry envelope reporter tests. Run with the repo's tsx (no new framework):
 *   node --import tsx --test packages/app/lib/analytics/sentry-envelope.test.ts
 *
 * Locks the DSN parsing and the envelope body, because a malformed envelope is
 * rejected silently by Sentry and we would be back to reporting nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseDsn, sendToSentry } from "./sentry-envelope.ts";

// The real mobile DSN shape (key/host/project are the production values'
// format, not the values themselves).
const DSN = "https://abc123def456@o4511776624541696.ingest.us.sentry.io/4511776736608256";

test("parseDsn builds the envelope endpoint from a DSN", () => {
  const p = parseDsn(DSN);
  assert.ok(p);
  assert.equal(p.publicKey, "abc123def456");
  assert.equal(
    p.endpoint,
    "https://o4511776624541696.ingest.us.sentry.io/api/4511776736608256/envelope/",
  );
});

test("parseDsn refuses anything that is not a usable DSN", () => {
  // An unset env var is the common case and must be a quiet no-op, not a throw.
  assert.equal(parseDsn(undefined), null);
  assert.equal(parseDsn(null), null);
  assert.equal(parseDsn(""), null);
  assert.equal(parseDsn("not-a-dsn"), null);
  // http:// is refused — reports must not travel in clear text.
  assert.equal(parseDsn("http://k@host/1"), null);
  // Missing project id.
  assert.equal(parseDsn("https://k@host"), null);
});

test("sendToSentry posts a 3-line envelope with a fatal crash event", async () => {
  const calls: Array<{ url: string; body: string; contentType?: string }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: String(init.body),
      contentType: (init.headers as Record<string, string>)?.["Content-Type"],
    });
    return { ok: true, status: 200, text: async () => "{}" } as Response;
  }) as typeof fetch;

  try {
    sendToSentry(
      {
        name: "TypeError",
        message: "Cannot read property 'id' of null",
        stack: "at save (app:///main.jsbundle:1:100)\nat onPress (app:///main.jsbundle:1:200)",
        featureArea: "crash",
        platform: "ios",
        extra: { screen: "EditEvent" },
      },
      DSN,
    );
    // sendToSentry is fire-and-forget; let the microtask queue drain.
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.ok(call.url.includes("/api/4511776736608256/envelope/"));
    assert.ok(call.url.includes("sentry_key=abc123def456"));
    assert.equal(call.contentType, "application/x-sentry-envelope");

    // Envelope = header line, item header line, payload line.
    const lines = call.body.trimEnd().split("\n");
    assert.equal(lines.length, 3);
    const header = JSON.parse(lines[0]);
    const itemHeader = JSON.parse(lines[1]);
    const event = JSON.parse(lines[2]);

    assert.match(header.event_id, /^[0-9a-f]{32}$/);
    assert.equal(itemHeader.type, "event");
    // Same id in both, or Sentry drops the item.
    assert.equal(event.event_id, header.event_id);
    assert.equal(event.level, "fatal"); // featureArea "crash" => fatal
    assert.equal(event.tags.feature_area, "crash");
    assert.equal(event.tags.runtime, "ios");
    assert.equal(event.exception.values[0].type, "TypeError");
    assert.equal(
      event.exception.values[0].value,
      "Cannot read property 'id' of null",
    );
    assert.equal(event.extra.screen, "EditEvent");
    // Frames are reversed to Sentry's oldest-first order.
    const frames = event.exception.values[0].stacktrace.frames;
    assert.equal(frames[frames.length - 1].function, "save");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a non-crash area reports as error, and no DSN sends nothing", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push(String(init.body));
    return { ok: true, status: 200, text: async () => "{}" } as Response;
  }) as typeof fetch;

  try {
    sendToSentry({ message: "outbox drain failed", featureArea: "outbox" }, DSN);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 1);
    assert.equal(JSON.parse(calls[0].trimEnd().split("\n")[2]).level, "error");

    // Unconfigured DSN must not attempt a request at all.
    sendToSentry({ message: "x", featureArea: "crash" }, undefined);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
