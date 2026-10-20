#!/usr/bin/env node
// Run: node scripts/test-lynk-watermark-dom.cjs
// Render the production capture boundary and its real guard/overlays, using
// the actual room's JSX attributes rather than duplicating its capture policy.
// Only third-party AntiCapture, telemetry, and decorative icons are isolated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const dependencyPaths = [...(process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean), path.resolve(__dirname, "..")];
const resolveDependency = name => require.resolve(name, { paths: dependencyPaths });
const { build } = require(resolveDependency("esbuild"));

(async () => {
  const { Window } = await import(resolveDependency("happy-dom"));
  const window = new Window();
  Object.assign(global, {
    window,
    document: window.document,
    Node: window.Node,
    HTMLElement: window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const previousFlag = process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION;
  process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION = "true";

  const root = path.resolve(__dirname, "..");
  const room = fs.readFileSync(path.join(root, "packages/app/features/sneaky-lynk/screens/room.web.tsx"), "utf8");
  const opening = room.match(/<SecureCaptureBoundary\b[\s\S]*?\n\s+>/)?.[0];
  assert.ok(opening, "the room must retain its capture-protection boundary");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lynk-watermark-"));
  const mocks = {
    "react-anticapture": `
      export const calls = [];
      export default function AntiCapture(props) { calls.push(props); return props.children; }
    `,
    "@dvnt/observability": "export const addSentryBreadcrumb = () => {};",
    "lucide-react": "export const ShieldAlert = () => null;",
    "@dvnt/app/components/logo.web": "export default () => null;",
  };
  let unmount;
  try {
    await build({
      stdin: {
        contents: `
          import React, { act } from 'react';
          import { createRoot } from 'react-dom/client';
          import { SecureCaptureBoundary } from './packages/app/lib/secure-capture/SecureCaptureBoundary';
          export { calls as antiCaptureCalls } from 'react-anticapture';
          export { act };
          export const attempts = [];
          export let clicks = 0;
          function RoomFixture({ phase, joinAnonymous }) {
            const id = 'fixture-room';
            const roomSnapshot = { fishjamRoomId: 'fixture-session' };
            const authUser = { id: 'fixture-user', username: 'fixture-viewer' };
            const currentUser = { anonLabel: 'fixture-anonymous' };
            const captureBroadcast = { notifyLocalCapture: kind => attempts.push(kind) };
            return (
              ${opening}
                <main>
                  <video data-live-video />
                  <button onClick={() => clicks++}>Mute microphone</button>
                  <p>Room description stays visible</p>
                </main>
              </SecureCaptureBoundary>
            );
          }
          export function mount(node) {
            const root = createRoot(node);
            return {
              room: (phase, joinAnonymous = false) => root.render(<RoomFixture phase={phase} joinAnonymous={joinAnonymous} />),
              defaultBoundary: () => root.render(<SecureCaptureBoundary enabled userHandle="fixture-control"><video /></SecureCaptureBoundary>),
              unmount: () => root.unmount(),
            };
          }
        `,
        resolveDir: root,
        loader: "tsx",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      tsconfigRaw: { compilerOptions: { jsx: "react-jsx" } },
      alias: { "react": path.dirname(resolveDependency("react/package.json")), "react-dom": path.dirname(resolveDependency("react-dom/package.json")) },
      outfile: path.join(dir, "fixture.cjs"),
      plugins: [{
        name: "capture-boundary-fixture",
        setup(build) {
          build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined);
          build.onLoad({ filter: /.*/, namespace: "mock" }, args => ({ contents: mocks[args.path], loader: "js", resolveDir: root }));
        },
      }],
      nodePaths: (process.env.NODE_PATH || "").split(path.delimiter).filter(Boolean),
    });

    const fixture = require(path.join(dir, "fixture.cjs"));
    const { act, attempts, antiCaptureCalls } = fixture;
    const node = document.createElement("div");
    document.body.append(node);
    const renderer = fixture.mount(node);
    unmount = renderer.unmount;
    const assertNoWatermark = () => {
      assert.equal(node.querySelectorAll('span').length, 0, "no repeated watermark spans may cover the video");
      assert.doesNotMatch(node.textContent, /fixture-viewer|fixture-anonymous|fixture-room|fixture-session/);
      assert.ok(node.querySelector("video[data-live-video]"));
      assert.match(node.textContent, /Room description stays visible/);
    };

    for (const phase of ["joining", "connecting", "connected"]) {
      for (const anonymous of [false, true]) {
        await act(async () => renderer.room(phase, anonymous));
        assertNoWatermark();
        assert.ok(node.querySelector('[data-secure-capture-boundary="sneaky-lynk"]'), `${phase}: protection remains mounted`);
        const before = fixture.clicks;
        await act(async () => node.querySelector("button").click());
        assert.equal(fixture.clicks, before + 1, "the child control remains interactive");
        const props = antiCaptureCalls.at(-1);
        assert.equal(props.screenshotPrevent, true);
        assert.equal(props.clipboardPrevent, true);
        assert.equal(props.devtoolsPrevent, false);
      }
    }

    const copy = new window.Event("copy", { bubbles: true, cancelable: true });
    await act(async () => node.querySelector("video").dispatchEvent(copy));
    assert.equal(copy.defaultPrevented, true, "the actual scoped copy guard is still active");

    await act(async () => window.dispatchEvent(new window.Event("blur")));
    assert.match(node.textContent, /Return to the room to continue/);
    assert.deepEqual(attempts, [], "focus loss is not falsely reported as capture");
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    assertNoWatermark();

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => document.dispatchEvent(new window.Event("visibilitychange")));
    assert.match(node.textContent, /Return to the room to continue/);
    assert.deepEqual(attempts, [], "tab hiding remains local-only protection");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    assertNoWatermark();

    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keyup", { key: "PrintScreen" })));
    assert.deepEqual(attempts, ["screenshot"], "actual capture signals still reach the room callback");
    assertNoWatermark();

    await act(async () => renderer.room("idle"));
    assertNoWatermark();
    assert.equal(node.querySelector("[data-secure-capture-boundary]"), null);

    // Negative control: the real overlay still renders for other consumers
    // that use the shared boundary's unchanged default.
    await act(async () => renderer.defaultBoundary());
    assert.equal(node.querySelectorAll("span").length, 48);
    assert.match(node.textContent, /@fixture-control/);
    await act(async () => unmount());
    unmount = undefined;
    console.log("PASS: Lynk videos have no watermark; controls, descriptions, blackout and capture reporting remain intact.");
  } finally {
    if (unmount) {
      const { act } = require(path.join(dir, "fixture.cjs"));
      await act(async () => unmount());
    }
    if (previousFlag === undefined) delete process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION;
    else process.env.EXPO_PUBLIC_SNEAKY_LYNK_WEB_CAPTURE_PROTECTION = previousFlag;
    await window.happyDOM.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
