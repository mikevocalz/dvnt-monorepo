/**
 * Server transport harness for media-upload's binary branch.
 *
 * This exercises the path a phone takes (raw body + x-* headers), which no
 * browser can reach: fetch() forbids setting Content-Length, and the web client
 * sends multipart. It proves the SERVER. It says nothing about whether the
 * native picker handed us the camera's original file — that needs a device.
 *
 * Run:
 *   DVNT_SESSION_TOKEN=<better-auth session token> \
 *   DVNT_FN_URL=https://<ref>.supabase.co/functions/v1/media-upload \
 *   DVNT_ANON_KEY=<anon key> \
 *   deno run --allow-net --allow-read --allow-env harness.ts <fixture.mp4> [case]
 *
 * Cases: ok | short-declare | long-declare | no-length | abort | oversize
 */

const FN_URL = Deno.env.get("DVNT_FN_URL");
const TOKEN = Deno.env.get("DVNT_SESSION_TOKEN");
const ANON = Deno.env.get("DVNT_ANON_KEY");

if (!FN_URL || !TOKEN || !ANON) {
  console.error(
    "Set DVNT_FN_URL, DVNT_SESSION_TOKEN and DVNT_ANON_KEY before running.",
  );
  Deno.exit(2);
}

const [path, testCase = "ok"] = Deno.args;
if (!path) {
  console.error("Pass a fixture path.");
  Deno.exit(2);
}

const info = await Deno.stat(path);
const realSize = info.size;

/** What we tell the server, per case — the server must not trust it. */
const declared: Record<string, number | null> = {
  ok: realSize,
  "short-declare": Math.floor(realSize / 2),
  "long-declare": realSize * 2,
  "no-length": null,
  abort: realSize,
  oversize: realSize,
};

const file = await Deno.open(path, { read: true });
let body: ReadableStream<Uint8Array> = file.readable;

if (testCase === "abort") {
  // Stop feeding halfway: the server must notice the truncation, refuse to
  // write a row, and delete the partial object rather than leave an orphan.
  const half = Math.floor(realSize / 2);
  let sent = 0;
  body = file.readable.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (sent >= half) {
          controller.terminate();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }),
  );
}

const headers: Record<string, string> = {
  Authorization: `Bearer ${TOKEN}`,
  apikey: ANON,
  "Content-Type": "video/mp4",
  "x-kind": "post-video",
  "x-file-name": path.split("/").pop() ?? "fixture.mp4",
  "x-mime": "video/mp4",
};
const claim = declared[testCase];
if (claim !== null && claim !== undefined) {
  headers["x-content-length"] = String(claim);
}

const started = performance.now();
let status = 0;
let text = "";
try {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers,
    body,
    // Deno requires this to send a stream body.
    ...({ duplex: "half" } as Record<string, unknown>),
  });
  status = res.status;
  text = await res.text();
} catch (err) {
  text = `transport error: ${err instanceof Error ? err.message : String(err)}`;
}
const elapsedMs = performance.now() - started;

const throughputMbps = (realSize * 8) / (elapsedMs / 1000) / 1_000_000;
console.log(
  JSON.stringify(
    {
      case: testCase,
      fixture: path,
      realBytes: realSize,
      declaredBytes: claim,
      httpStatus: status,
      elapsedMs: Math.round(elapsedMs),
      throughputMbps: Number(throughputMbps.toFixed(2)),
      response: text.slice(0, 400),
    },
    null,
    2,
  ),
);
