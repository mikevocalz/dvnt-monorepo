/**
 * Self-contained, version-pinned browser MoQ player for react-native-webview.
 *
 * RN → WebView: { type: "control", muted?: boolean, volume?: number }
 * WebView → RN: status, announced publisher paths, or an error message.
 * Navigation/page teardown releases discovery, players and the private connection.
 */
export interface MoqPlayerHtmlOptions {
  relayUrl: string;
  namespace: string;
  muted?: boolean;
  volume?: number;
  /** ESM CDN base; package versions remain pinned when overridden. */
  cdn?: string;
}

// JSON quoting alone does not prevent an HTML parser from ending a script tag.
const inlineJson = (value: unknown) => JSON.stringify(value)
  .replace(/</g, "\\u003c")
  .replace(/\u2028/g, "\\u2028")
  .replace(/\u2029/g, "\\u2029");

export function buildMoqPlayerHtml(opts: MoqPlayerHtmlOptions): string {
  const cdn = (opts.cdn ?? "https://esm.sh").replace(/\/+$/, "");
  const netUrl = inlineJson(`${cdn}/@moq/net@0.4.3?deps=@moq/signals@0.2.5`);
  const watchUrl = inlineJson(`${cdn}/@moq/watch@0.6.2?deps=@moq/net@0.4.3,@moq/signals@0.2.5`);
  const cfg = inlineJson({
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
  const post = (message) => { try { window.ReactNativeWebView.postMessage(JSON.stringify(message)); } catch {} };
  const stage = document.getElementById("stage");
  const players = new Map();
  const disposers = [];
  let connection;
  let closed = false;
  let stopAnnouncements = () => {};
  const dispose = () => {
    if (closed) return;
    closed = true;
    stopAnnouncements();
    for (const stop of disposers) stop();
    for (const { player, canvas } of players.values()) { player.close(); canvas.remove(); }
    players.clear();
    connection?.close();
    window.removeEventListener("pagehide", dispose);
    window.removeEventListener("beforeunload", dispose);
  };
  // Register before imports: navigating away during CDN loading must not start media.
  window.addEventListener("pagehide", dispose);
  window.addEventListener("beforeunload", dispose);
  try {
    const Moq = await import(${netUrl});
    const Watch = await import(${watchUrl});
    if (!closed) {
      const muted = new Moq.Signals.Signal(CFG.muted);
      const volume = new Moq.Signals.Signal(Number.isFinite(CFG.volume) ? Math.max(0, Math.min(1, CFG.volume)) : 1);
      connection = new Moq.Connection({
        url: new URL(CFG.relayUrl), enabled: true, share: false, linger: Moq.Time.Milli.zero,
      });
      const status = (value) => { if (!closed) post({ type: "status", status: value }); };
      disposers.push(connection.status.subscribe(status));
      status(connection.status.peek());

      const render = (routes) => {
        if (closed) return;
        const live = [...routes.keys()].map(String).filter((path) => path.startsWith(CFG.namespace + "/"));
        stage.className = live.length >= 2 ? "two" : "";
        for (const [path, entry] of players) {
          if (!live.includes(path)) { entry.player.close(); entry.canvas.remove(); players.delete(path); }
        }
        for (const path of live) {
          if (players.has(path)) continue;
          const canvas = document.createElement("canvas");
          const player = new Watch.Player({
            origin: connection.origin,
            probe: connection.probe,
            name: Moq.Path.from(path),
            canvas: new Moq.Signals.Signal(canvas),
            muted, volume, delay: Moq.Time.Milli.zero,
          });
          players.set(path, { player, canvas });
          stage.appendChild(canvas);
        }
        post({ type: "announced", paths: live });
      };
      const safeRender = (routes) => {
        try { render(routes); }
        catch (error) { dispose(); post({ type: "error", message: String(error?.message || error) }); }
      };
      const watchOrigin = (origin) => {
        stopAnnouncements();
        stopAnnouncements = () => {};
        if (closed) return;
        const routes = origin?.broadcasts();
        if (routes) {
          stopAnnouncements = routes.subscribe(safeRender);
          safeRender(routes.peek());
        } else safeRender(new Map());
      };
      disposers.push(connection.origin.subscribe(watchOrigin));
      watchOrigin(connection.origin.peek());

      const control = (event) => {
        if (closed) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type !== "control") return;
          if (typeof message.muted === "boolean") muted.set(message.muted);
          if (typeof message.volume === "number" && Number.isFinite(message.volume)) volume.set(Math.max(0, Math.min(1, message.volume)));
        } catch {}
      };
      // Android WebView dispatches on document; iOS dispatches on window.
      if (!closed) {
        window.addEventListener("message", control);
        document.addEventListener("message", control);
        disposers.push(() => window.removeEventListener("message", control));
        disposers.push(() => document.removeEventListener("message", control));
      }
    }
  } catch (error) {
    dispose();
    post({ type: "error", message: String(error?.message || error) });
  }
</script>
</body>
</html>`;
}
