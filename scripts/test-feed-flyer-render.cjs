#!/usr/bin/env node
/**
 * Focused production FeedEventCard React SSR checks.
 * Run: node scripts/test-feed-flyer-render.cjs
 * Dependencies: react, react-dom, typescript, jsdom (workspace install or NODE_PATH).
 * Optional: FEED_FLYER_BROWSER=1 adds Chromium geometry checks using playwright.
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


const icons = Object.fromEntries(["MapPin", "Clock", "Users", "Calendar", "Zap"].map((name) => [name, () => React.createElement("i", { "data-icon": name })]));
Object.assign(adapters, {
  "solito/navigation": { useRouter: () => ({ push() {} }) },
  "lucide-react": icons,
  "lucide-react-native": icons,
  "@tanstack/react-query": { useQueryClient: () => ({}) },
  "react-i18next": { useTranslation: () => ({ i18n: { language: "en" } }) },
  "@dvnt/app/lib/prefetch": { screenPrefetch: { eventDetail() {} } },
  "@dvnt/app/components/ui/translate-button": { TranslateButton: () => null },
  "@dvnt/app/lib/stores/translation-store": { useContentTranslation: () => ({ displayText: "", isTranslated: false }) },
  "@dvnt/app/lib/utils/language-detection": { shouldShowTranslateButton: () => false },
  "@dvnt/app/components/ui/zoom-card": { ZoomCard: ({ children, href, disabled }) => React.createElement("div", { "data-href": href, "data-disabled": disabled }, children) },
  "expo-image": { Image: ({ source, style, contentFit }) => React.createElement("img", { src: source.uri, style: { ...style, objectFit: contentFit } }) },
  "@dvnt/app/components/media/DVNTAnimatedVideoView": { DVNTAnimatedVideoView: ({ uri, contentFit, isPlaying, muted }) => React.createElement("video", { src: uri, muted, autoPlay: isPlaying, style: { objectFit: contentFit } }) },
});
adapters["react-native"].Text = ({ children, style }) => React.createElement("span", { style }, children);
Object.assign(sourceModules, {
  "../../lib/events/flyer-layout.ts": "packages/app/lib/events/flyer-layout.ts",
  "./feed-event-card-shape": "packages/app/components/event/feed-event-card-shape.ts",
  "@dvnt/app/components/event/feed-event-card-shape": "packages/app/components/event/feed-event-card-shape.ts",
  "@dvnt/app/components/event/EventFlyer.web": "packages/app/components/event/EventFlyer.web.tsx",
});
const { FeedEventCard: WebCard } = loadSource("packages/app/components/event/FeedEventCard.web.tsx");
const { FeedEventCard: NativeCard } = loadSource("packages/app/components/feed/feed-event-card.tsx");
const { JSDOM } = dependency("jsdom");
const render = (component, props) => new JSDOM(renderToStaticMarkup(React.createElement(component, props))).window.document;
const title = "Feed flyer title";
for (const [kind, media] of [
  ["video", { videoFlyerUrl: "https://example.test/flyer.mp4" }],
  ["image", { staticFlyerUrl: "https://example.test/flyer.png" }],
]) {
  test(`web ${kind} is contained in 4:6 media above details`, () => {
    const doc = render(WebCard, { data: { id: "event-1", title, category: "Music", dateDay: "30", month: "OCT", media: { title, ...media } } });
    const asset = doc.querySelector(kind === "video" ? "video" : "img");
    assert.ok(asset);
    assert.equal(asset.style.objectFit, "contain");
    assert.equal(asset.parentElement.style.aspectRatio, String(4 / 6));
    assert.equal(asset.parentElement.querySelector("h3"), null);
    const card = doc.querySelector('[role="button"]');
    assert.equal(card.querySelector("h3").textContent, title);
    assert.equal(card.children[1].style.height, "", "footer must size to its content");
    assert.equal(card.children[1].style.minHeight, "", "footer must not reserve blank space");
    assert.notEqual(card.children[1].style.justifyContent, "space-between");
    assert.equal(card.children[0].querySelector('[style*="linear-gradient"]'), null);
    if (kind === "video") for (const attr of ["muted", "autoplay", "loop", "playsinline"]) assert.ok(asset.hasAttribute(attr));
  });
  test(`native ${kind} is contained in 4:6 media above details and retains navigation`, () => {
    const doc = render(NativeCard, { event: { id: "event-1", title, image: media.staticFlyerUrl, flyerVideoUrl: media.videoFlyerUrl, category: "Music" } });
    const asset = doc.querySelector(kind === "video" ? "video" : "img");
    assert.equal(asset.style.objectFit, "contain");
    const canvas = [...doc.querySelectorAll("div")].find((node) => node.style.aspectRatio === String(4 / 6));
    assert.ok(canvas, "4:6 media canvas exists");
    assert.ok(canvas.contains(asset));
    assert.ok(!canvas.textContent.includes(title));
    assert.equal(canvas.nextElementSibling.style.minHeight, "", "native footer must not reserve blank space");
    assert.ok(![...canvas.nextElementSibling.querySelectorAll("div")].some((node) => node.style.flex === "1"), "native footer must not stretch its content away from badges");
    assert.equal(doc.querySelector("[data-href]").getAttribute("data-href"), "/(protected)/events/event-1");
  });
}
test("native guest gating remains enabled", () => {
  const doc = render(NativeCard, { event: { id: "event-1", title }, guestMode: true });
  assert.equal(doc.querySelector("[data-disabled]").getAttribute("data-disabled"), "true");
});
test("web missing media keeps generated fallback title", () => {
  const doc = render(WebCard, { data: { id: "event-1", title, media: { title } } });
  assert.equal(doc.querySelector('[aria-label="Feed flyer title"]').textContent, title);
});

if (process.env.FEED_FLYER_BROWSER === "1") {
  test("Chromium: compact responsive footer preserves artwork and long text", async () => {
    const { chromium } = dependency("playwright");
      const { build } = dependency("esbuild");
      const bundled = await build({
        stdin: { contents: `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import { FeedEventCard } from "./packages/app/components/event/FeedEventCard.web.tsx";
          const root = createRoot(document.querySelector("main"));
          const onHeightChange = (id,width,height) => window.measurements.push({id,width,height});
          window.renderCard = data => { window.measurements = []; root.render(React.createElement(FeedEventCard, {data,onHeightChange})); };
        `, resolveDir: root, loader: "tsx" },
        bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
        nodePaths: [path.dirname(require.resolve("react/package.json", { paths: dependencyRoots })) + "/.."],
        plugins: [{ name: "feed-test-adapters", setup(builder) {
          builder.onResolve({ filter: /^(solito\/navigation|lucide-react|@dvnt\/app\/lib\/color\/useEventDominantColor|@dvnt\/app\/lib\/theme)$/ }, args => ({ path: args.path, namespace: "test-stub" }));
          builder.onLoad({ filter: /.*/, namespace: "test-stub" }, args => ({ contents:
            args.path === "solito/navigation" ? "export const useRouter = () => ({push(){}});" :
            args.path === "lucide-react" ? 'import React from "react"; const Icon=()=>React.createElement("i",{style:{display:"inline-block",width:10,height:10}}); export const MapPin=Icon,Clock=Icon,Users=Icon,Calendar=Icon,Zap=Icon;' :
            args.path.endsWith("useEventDominantColor") ? 'export const useEventDominantColor=()=>({color:"#111111"});' :
            'export const color={inkDeep:"#080a12",violet:"#8a40cf",text:"#ffffff"};', loader: "js", resolveDir: root }));
          builder.onResolve({ filter: /^@dvnt\/app\// }, args => ({ path: path.join(root, "packages/app", args.path.replace("@dvnt/app/", "")) + (args.path.endsWith("EventFlyer.web") ? ".tsx" : ".ts") }));
        } }],
      });
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent('<style>*{box-sizing:border-box}body{margin:0;font-family:Arial;line-height:1.5}</style><main></main>');
      await page.addScriptTag({ content: bundled.outputFiles[0].text });
      const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="900" height="1600" fill="purple"/></svg>');
      const fixtures = [
        { name: "short", title: "DALLAS Freaky Friday", category: "Other", dateDay: "30", month: "OCT", location: "Station 4", time: "10:00 PM EDT", attendeeCount: 40 },
        { name: "long", title: "A deliberately long event title that takes up two lines of detail text", category: "Music", dateDay: "30", month: "OCT", location: "A long venue name in the city", time: "10:00 PM EDT", attendeeCount: 400 },
        { name: "minimal", title: "Event title" },
      ];
      for (const width of [280, 320, 333.339, 390, 768, 1024]) for (const fixture of fixtures) {
        await page.evaluate(({ width, data }) => {
          document.querySelector("main").style.width = `${width}px`;
          window.renderCard(data);
        }, { width, data: { id: `event-${width}-${fixture.name}`, ...fixture, media: { title: fixture.title, staticFlyerUrl: svg } } });
        await page.waitForFunction(() => window.measurements.length > 0);
        const geometry = await page.evaluate(() => {
          const outer = document.querySelector("main").firstElementChild;
          const card = document.querySelector('[role="button"]');
          const media = card.children[0].getBoundingClientRect();
          const footer = card.children[1];
          const details = footer.getBoundingClientRect();
          const top = footer.children[0].getBoundingClientRect();
          const bottom = footer.children[1].getBoundingClientRect();
          return { measured: window.measurements.at(-1), width: outer.getBoundingClientRect().width, height: outer.getBoundingClientRect().height, mediaBottom: media.bottom, detailsTop: details.top, detailsBottom: details.bottom, footerHeight: details.height, topBottom: top.bottom, bottomTop: bottom.top, bottomBottom: bottom.bottom, mediaWidth: media.width, mediaHeight: media.height, footerScrollHeight: footer.scrollHeight, footerClientHeight: footer.clientHeight };
        });
        const label = `${fixture.name} at ${width}px`;
        assert.ok(Math.abs(geometry.measured.height - geometry.height) < 0.5, `height callback disagrees with rendered card: ${label}`);
        assert.ok(Math.abs(geometry.measured.width - geometry.width) < 0.5, `width callback disagrees with rendered card: ${label}`);
        const { feedEventCardMeasurementKey } = loadSource("packages/app/components/event/feed-event-card-shape.ts");
        assert.equal(feedEventCardMeasurementKey("event", width), feedEventCardMeasurementKey("event", geometry.measured.width), `packer and DOM measurement keys differ: ${label}`);
        assert.ok(Math.abs(geometry.height - (geometry.mediaHeight + geometry.footerHeight + 24)) < 1, `unexpected blank outer area: ${label}`);
        assert.ok(Math.abs(geometry.mediaWidth / geometry.mediaHeight - 4 / 6) < 0.001);
        assert.ok(geometry.mediaBottom <= geometry.detailsTop);
        const gap = geometry.bottomTop - geometry.topBottom;
        assert.ok(gap >= -0.5 && gap <= 12.5, `footer gap ${gap}px must be compact: ${label}`);
        assert.ok(geometry.detailsBottom - geometry.bottomBottom <= 14.5, `excessive footer bottom padding: ${label}`);
        assert.ok(geometry.bottomBottom <= geometry.detailsBottom, `footer content clipped: ${label}`);
        assert.ok(geometry.footerScrollHeight <= geometry.footerClientHeight + 1, `footer content overflows: ${label}`);
        if (fixture.name === "short") assert.ok(geometry.footerHeight < 180, `short footer is unnecessarily tall: ${label}`);
        if (fixture.name === "minimal") assert.ok(geometry.footerHeight < 100, `minimal footer is unnecessarily tall: ${label}`);
      }
      // Resize the same mounted event: this must be caught by ResizeObserver,
      // rather than only by the layout effect when an event id changes.
      await page.evaluate(() => {
        window.measurements = [];
        document.querySelector("main").style.width = "280px";
      });
      await page.waitForFunction(() => window.measurements.some((item) => Math.abs(item.width - 280) < 0.5));
      const resized = await page.evaluate(() => ({ reported: window.measurements.at(-1).height, actual: document.querySelector("main").firstElementChild.getBoundingClientRect().height }));
      assert.ok(Math.abs(resized.reported - resized.actual) < 0.5, "observer reports new height after same-event resize");
      await page.evaluate(({ svg }) => window.renderCard({
        id: "event-1024-minimal", title: "A much longer title that must occupy two lines after the same mounted event is edited",
        category: "Music", dateDay: "30", month: "OCT", location: "A longer venue name", time: "10:00 PM EDT", attendeeCount: 40,
        media: { title: "Edited event", staticFlyerUrl: svg },
      }), { svg });
      await page.waitForFunction(() => window.measurements.length > 0);
      const edited = await page.evaluate(() => ({ reported: window.measurements.at(-1).height, actual: document.querySelector("main").firstElementChild.getBoundingClientRect().height }));
      assert.ok(Math.abs(edited.reported - edited.actual) < 0.5, "observer reports new height after same-event metadata update");
      assert.ok(edited.actual > resized.actual, "long metadata expands naturally instead of clipping");
    } finally { await browser.close(); }
  });
}
