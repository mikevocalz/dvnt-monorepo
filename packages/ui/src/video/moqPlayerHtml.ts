/**
 * Self-contained HTML for the WebView-hosted MoQ player (native viewer path —
 * docs/lynk-moq-fit.md §6.1). `@moq` is browser-only, so on mobile we run it
 * inside a `react-native-webview`.
 *
 * JS-BRIDGE CONTRACT (the spike's deliverable):
 *   RN → WebView (window.postMessage JSON):
 *     { type: "control", muted?: boolean, volume?: number }
 *   WebView → RN (window.ReactNativeWebView.postMessage JSON):
 *     { type: "status", status: "connecting"|"connected"|"disconnected" }
 *     { type: "announced", paths: string[] }   // live publisher paths
 *     { type: "error", message: string }
 *
 * The player connects with a subscribe-scoped relay URL, runs `connection.announced`
 * discovery, and paints one `<canvas>` per publisher in a responsive grid.
 *
 * NOTE: pulls `@moq/*` from an ESM CDN at runtime (the WebView has network). For
 * production hardening, vendor the bundle and pin a version / SRI instead of CDN.
 */

export interface MoqPlayerHtmlOptions {
  relayUrl: string;
  namespace: string;
  muted?: boolean;
  volume?: number;
  /** ESM CDN base — override to vendor/pin. */
  cdn?: string;
}

export function buildMoqPlayerHtml(opts: MoqPlayerHtmlOptions): string {
  const cdn = opts.cdn ?? "https://esm.sh";
  // JSON-encode to safely inline into the script.
  const cfg = JSON.stringify({
    relayUrl: opts.relayUrl,
    namespace: opts.namespace,
    muted: opts.muted ?? false,
    volume: opts.volume ?? 1,
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<style>
  html,body { margin:0; height:100%; background:#06070d; overflow:hidden; }
  #stage { display:grid; gap:6px; width:100vw; height:100vh; padding:6px; box-sizing:border-box;
           grid-template-columns:1fr; }
  #stage.two { grid-template-columns:1fr 1fr; }
  canvas { width:100%; height:100%; object-fit:cover; border-radius:16px; background:#000; }
</style>
</head>
<body>
<div id="stage"></div>
<script type="module">
  const CFG = ${cfg};
  const post = (m) => { try { window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch (e) {} };
  try {
    const Moq = await import("${cdn}/@moq/lite");
    const Watch = await import("${cdn}/@moq/watch");

    const reload = new Moq.Connection.Reload({ url: new Moq.Signals?.Signal
      ? new Moq.Signals.Signal(new URL(CFG.relayUrl)) : new URL(CFG.relayUrl), enabled: true });

    reload.status.subscribe((s) => post({ type: "status", status: s }));

    const stage = document.getElementById("stage");
    const backends = new Map();
    let muted = CFG.muted, volume = CFG.volume;

    const render = (paths) => {
      const live = paths.filter((p) => p.startsWith(CFG.namespace + "/"));
      stage.className = live.length >= 2 ? "two" : "";
      // remove dropped
      for (const [path, b] of backends) {
        if (!live.includes(path)) { b.backend.close(); b.canvas.remove(); backends.delete(path); }
      }
      // add new
      for (const path of live) {
        if (backends.has(path)) continue;
        const canvas = document.createElement("canvas");
        stage.appendChild(canvas);
        const backend = new Watch.MultiBackend({
          element: canvas,
          broadcast: new Watch.Broadcast({ connection: reload.established, name: Moq.Path.from(path), enabled: true }),
          latency: "real-time",
          paused: false,
        });
        backend.audio.muted.set(muted);
        backend.audio.volume.set(volume);
        backends.set(path, { backend, canvas });
      }
      post({ type: "announced", paths: live });
    };

    reload.announced.subscribe((set) => render([...set].map(String)));

    window.addEventListener("message", (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type !== "control") return;
        if (typeof m.muted === "boolean") { muted = m.muted; for (const { backend } of backends.values()) backend.audio.muted.set(muted); }
        if (typeof m.volume === "number") { volume = m.volume; for (const { backend } of backends.values()) backend.audio.volume.set(volume); }
      } catch (e) {}
    });
  } catch (err) {
    post({ type: "error", message: String(err && err.message || err) });
  }
</script>
</body>
</html>`;
}
