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
  test(`web ${kind} is contained in portrait media above details`, () => {
    const doc = render(WebCard, { data: { id: "event-1", title, category: "Music", dateDay: "30", month: "OCT", media: { title, ...media } } });
    const asset = doc.querySelector(kind === "video" ? "video" : "img");
    assert.ok(asset);
    assert.equal(asset.style.objectFit, "contain");
    assert.equal(asset.parentElement.style.aspectRatio, "0.5625");
    assert.equal(asset.parentElement.querySelector("h3"), null);
    const card = doc.querySelector('[role="button"]');
    assert.equal(card.querySelector("h3").textContent, title);
    assert.equal(card.children[1].style.height, "200px");
    assert.equal(card.children[0].querySelector('[style*="linear-gradient"]'), null);
    if (kind === "video") for (const attr of ["muted", "autoplay", "loop", "playsinline"]) assert.ok(asset.hasAttribute(attr));
  });
  test(`native ${kind} is contained above details and retains navigation`, () => {
    const doc = render(NativeCard, { event: { id: "event-1", title, image: media.staticFlyerUrl, flyerVideoUrl: media.videoFlyerUrl, category: "Music" } });
    const asset = doc.querySelector(kind === "video" ? "video" : "img");
    assert.equal(asset.style.objectFit, "contain");
    const canvas = [...doc.querySelectorAll("div")].find((node) => node.style.aspectRatio === "0.5625");
    assert.ok(canvas.contains(asset));
    assert.ok(!canvas.textContent.includes(title));
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
  test("Chromium: responsive card matches reserved masonry height with unobscured artwork", async () => {
    const { chromium } = dependency("playwright");
    const { feedEventCardHeight } = loadSource("packages/app/components/event/feed-event-card-shape.ts");
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      const svg = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1600"><rect width="900" height="1600" fill="purple"/></svg>');
      for (const width of [280, 320, 390, 768, 1024]) {
        const html = renderToStaticMarkup(React.createElement(WebCard, { data: {
          id: "event-1", title: "A deliberately long event title that takes up two lines of detail text", category: "Music", dateDay: "30", month: "OCT",
          location: "A long venue name in the city", time: "10:00 PM EDT", attendeeCount: 400, media: { title, staticFlyerUrl: svg },
        } }));
        await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;font-family:Arial;line-height:1.5}</style><main style="width:${width}px">${html}</main>`);
        const geometry = await page.evaluate(() => {
          const outer = document.querySelector("main").firstElementChild;
          const card = document.querySelector('[role="button"]');
          const media = card.children[0].getBoundingClientRect();
          const details = card.children[1].getBoundingClientRect();
          const top = card.children[1].children[0].getBoundingClientRect();
          const bottom = card.children[1].children[1].getBoundingClientRect();
          return { height: outer.getBoundingClientRect().height, mediaBottom: media.bottom, detailsTop: details.top, topBottom: top.bottom, bottomTop: bottom.top, mediaWidth: media.width, mediaHeight: media.height };
        });
        assert.ok(Math.abs(geometry.height - feedEventCardHeight(width)) < 1, `width ${width}: measured ${geometry.height}, reserved ${feedEventCardHeight(width)}`);
        assert.ok(Math.abs(geometry.mediaWidth / geometry.mediaHeight - 9 / 16) < 0.001);
        assert.ok(geometry.mediaBottom <= geometry.detailsTop);
        assert.ok(geometry.topBottom <= geometry.bottomTop, `footer content overlaps at ${width}px`);
      }
    } finally { await browser.close(); }
  });
}
