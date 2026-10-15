#!/usr/bin/env node
/**
 * Focused React SSR checks for portrait flyers and text-post markup.
 * Run: node scripts/test-flyer-layout-render.cjs
 * Dependencies: react, react-dom, typescript (workspace install or NODE_PATH).
 * Actual components and constants are used; the unrelated color hook and
 * native drawing primitives are adapted. This is not browser/device QA.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const dependencyRoots = [path.join(root, "apps/web"), path.join(root, "packages/app"), root];
const dependency = (name) => require(require.resolve(name, { paths: dependencyRoots }));
const React = dependency("react");
const jsxRuntime = dependency("react/jsx-runtime");
const { renderToStaticMarkup } = dependency("react-dom/server");
const ts = dependency("typescript");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const moduleCache = new Map();
const flattenStyle = (style) => Array.isArray(style)
  ? Object.assign({}, ...style.filter(Boolean).map(flattenStyle)) : style || {};

// Content and conditional rendering still come from the production components.
const adapters = {
  react: React,
  "react/jsx-runtime": jsxRuntime,
  "react-native": {
    View({ style, children }) {
      const domStyle = { ...flattenStyle(style) };
      for (const key of ["shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"])
        delete domStyle[key];
      return React.createElement("div", { style: domStyle }, children);
    },
  },
  "expo-linear-gradient": {
    LinearGradient({ style, colors, children }) {
      return React.createElement("div", {
        style: { ...flattenStyle(style), background: `linear-gradient(135deg, ${colors.join(", ")})` },
      }, children);
    },
  },
  "@dvnt/app/lib/color/useEventDominantColor": {
    useEventDominantColor: () => ({ color: "#111111" }),
  },
  "@dvnt/app/lib/theme": {
    color: { inkDeep: "#080a12", violet: "#8a40cf", text: "#ffffff" },
  },
  "@dvnt/app/components/ui/hashtag-text": {
    HashtagText: ({ text }) => React.createElement("div", null, text),
  },
  "./TextPostBadgeLogo": {
    TextPostBadgeLogo: () => React.createElement("span", { "aria-label": "Text post logo" }, "LOGO"),
  },
};
const sourceModules = {
  "@dvnt/app/lib/events/flyer-layout": "packages/app/lib/events/flyer-layout.ts",
  "@dvnt/app/lib/posts/text-post": "packages/app/lib/posts/text-post.ts",
};

function loadSource(relative, sourceOverride) {
  if (moduleCache.has(relative)) return moduleCache.get(relative);
  const filename = path.join(root, relative);
  const compiled = ts.transpileModule(sourceOverride ?? source(relative), {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    },
    reportDiagnostics: true,
  });
  const errors = (compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (name) => name, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (name) => {
    if (Object.hasOwn(adapters, name)) return adapters[name];
    if (Object.hasOwn(sourceModules, name)) return loadSource(sourceModules[name]);
    throw new Error(`Unexpected dependency in flyer render test: ${name}`);
  };
  loaded._compile(compiled.outputText, filename);
  moduleCache.set(relative, loaded.exports);
  return loaded.exports;
}

const { EventFlyer } = loadSource("packages/app/components/event/EventFlyer.web.tsx");
const { TextPostSurface } = loadSource("packages/app/features/post/ui/TextPostSurface.tsx");
const media = {
  title: "Portrait Flyer",
  videoFlyerUrl: "https://example.test/flyer.mp4",
  staticFlyerUrl: "https://example.test/poster.png",
};
const renderFlyer = (props = {}) => renderToStaticMarkup(React.createElement(EventFlyer, { media, ...props }));

for (const [label, props] of [
  ["video", { autoplay: true }],
  ["static image", { staticOnly: true }],
  ["missing-media fallback", { media: { title: "Missing Media" } }],
]) {
  test(`EventFlyer ${label} renders a 9:16 canvas`, () => {
    assert.match(renderFlyer(props), /aspect-ratio:0\.5625(?:;|")/);
  });
}

test("EventFlyer preserves explicit caller aspect overrides", () => {
  assert.match(renderFlyer({ aspect: 4 / 5 }), /aspect-ratio:0\.8(?:;|")/);
});

test("EventFlyer contains video and image artwork without cover cropping", () => {
  assert.match(renderFlyer(), /<video[^>]*object-fit:contain/);
  assert.match(renderFlyer({ staticOnly: true }), /<img[^>]*object-fit:contain/);
});

test("EventFlyer preserves autoplay prerequisites", () => {
  const videoTag = renderFlyer({ autoplay: true }).match(/<video[^>]*>/)?.[0];
  assert.ok(videoTag);
  for (const attribute of ["muted", "loop", "playsInline", "autoPlay"])
    assert.match(videoTag, new RegExp(`${attribute}=""`));
});

test("EventFlyer staticOnly omits video and missing-media fallback has its title", () => {
  assert.doesNotMatch(renderFlyer({ staticOnly: true }), /<video/);
  assert.match(renderFlyer({ staticOnly: true }), /<img/);
  assert.match(renderFlyer({ media: { title: "Missing Media" } }), /Missing Media/);
});

test("actual event detail video markup has a contained 9:16 canvas", () => {
  // Extract production JSX so changes to its geometry break this assertion.
  const detailSource = source("packages/app/features/events/event-detail.web.tsx");
  const videoJsx = detailSource.match(/<video\s+src=\{coverVideoUrl\}[\s\S]*?\/>/);
  assert.ok(videoJsx, "event detail cover video JSX must exist");
  const { DetailVideo } = loadSource("scripts/flyer-detail-fixture.tsx", `
    import { EVENT_FLYER_ASPECT } from '@dvnt/app/lib/events/flyer-layout';
    const coverVideoUrl = 'https://example.test/flyer.mp4';
    const coverPosterUrl = 'https://example.test/poster.png';
    export function DetailVideo() { return (${videoJsx[0]}); }
  `);
  const html = renderToStaticMarkup(React.createElement(DetailVideo));
  assert.match(html, /aspect-ratio:0\.5625(?:;|")/);
  assert.match(html, /class="[^"]*object-contain/);
  assert.doesNotMatch(html, /object-cover|aspect-video/);
});

for (const variant of ["composer", "feed", "detail", "grid"]) {
  test(`TextPostSurface ${variant} retains user text without automatic tagline`, () => {
    const html = renderToStaticMarkup(React.createElement(TextPostSurface, {
      text: "My own message #hello", variant,
    }));
    assert.match(html, /My own message #hello/);
    assert.doesNotMatch(html, /Let.s connect, share and build community/);
  });
}
