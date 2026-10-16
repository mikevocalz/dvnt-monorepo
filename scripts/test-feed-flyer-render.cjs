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
    View({ style, children, pointerEvents }) {
      const domStyle = { ...flattenStyle(style) };
      for (const key of ["shadowColor", "shadowOffset", "shadowOpacity", "shadowRadius"])
        delete domStyle[key];
      return React.createElement("div", { style: domStyle, "data-pointer-events": pointerEvents }, children);
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
  "@dvnt/app/components/ui/card-link.web": "packages/app/components/ui/card-link.web.tsx",
  "@dvnt/app/lib/events/event-detail-route": "packages/app/lib/events/event-detail-route.ts",
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
  test(`web ${kind} is contained in fixed 2:3 media above details`, () => {
    const doc = render(WebCard, { data: { id: "42", title, category: "Music", dateDay: "30", month: "OCT", media: { title, ...media } } });
    const asset = doc.querySelector(kind === "video" ? "video" : "img");
    assert.ok(asset);
    assert.equal(asset.style.objectFit, "contain");
    assert.equal(asset.parentElement.style.aspectRatio, String(4 / 6));
    assert.equal(asset.parentElement.querySelector("h3"), null);
    const card = doc.querySelector('a[href^="/feed/events/"]');
    assert.equal(card.querySelector("h3").textContent, title);
    assert.equal(card.getAttribute("href"), "/feed/events/42");
    assert.equal(card.children[0].style.pointerEvents, "none", "media must not intercept navigation taps");
    assert.equal(card.children[1].style.height, "", "footer must size to its content");
    assert.equal(card.children[1].style.minHeight, "", "footer must not reserve blank space");
    assert.notEqual(card.children[1].style.justifyContent, "space-between");
    const header = card.children[1].children[0];
    const date = header.lastElementChild;
    assert.equal(date.style.display, "inline-flex", "date must be one compact inline row");
    assert.ok(![...date.children].some((node) => node.style.display === "block"), "day/month must not stack into a tall badge");
    assert.equal(card.children[0].querySelector('[style*="linear-gradient"]'), null);
    if (kind === "video") for (const attr of ["muted", "autoplay", "loop", "playsinline"]) assert.ok(asset.hasAttribute(attr));
  });
  test(`native ${kind} is contained in fixed 2:3 media and retains navigation`, () => {
    const doc = render(NativeCard, { event: { id: "42", title, image: media.staticFlyerUrl, flyerVideoUrl: media.videoFlyerUrl, category: "Music", date: "30", month: "OCT" } });
    const asset = doc.querySelector(kind === "video" ? "video" : "img");
    assert.equal(asset.style.objectFit, "contain");
    const canvas = [...doc.querySelectorAll("div")].find((node) => node.style.aspectRatio === String(4 / 6));
    assert.ok(canvas, "4:6 media canvas exists");
    assert.ok(canvas.contains(asset));
    assert.equal(canvas.getAttribute("data-pointer-events"), "none", "native media must let the card receive taps");
    assert.ok(!canvas.textContent.includes(title));
    assert.equal(canvas.nextElementSibling.style.minHeight, "", "native footer must not reserve blank space");
    const nativeDate = canvas.nextElementSibling.firstElementChild.lastElementChild;
    assert.equal(nativeDate.style.flexDirection, "row", "native day/month must share one row");
    assert.ok(Number.parseFloat(nativeDate.firstElementChild.style.fontSize) <= 12, "native date should not dominate the header");
    assert.ok(![...canvas.nextElementSibling.querySelectorAll("div")].some((node) => node.style.flex === "1"), "native footer must not stretch its content away from badges");
    assert.equal(doc.querySelector("[data-href]").getAttribute("data-href"), "/(protected)/events/42");
  });
}
test("sparse metadata keeps a compact footer without invented date values", () => {
  for (const metadata of [{}, { category: "Music" }, { dateDay: "30" }, { month: "OCT" }]) {
    const doc = render(WebCard, { data: { id: "42", title, ...metadata, media: { title } } });
    const footer = doc.querySelector('a[href="/feed/events/42"]').children[1];
    assert.equal(footer.style.height, "");
    assert.equal(footer.style.minHeight, "");
    assert.equal(footer.style.gap, "8px");
    assert.ok(!footer.textContent.includes("undefined"));
    assert.ok(!footer.textContent.includes("null"));
    assert.equal(footer.querySelector("h3").textContent, title);
  }
});

test("native guest gating remains enabled", () => {
  const doc = render(NativeCard, { event: { id: "42", title }, guestMode: true });
  assert.equal(doc.querySelector("[data-disabled]").getAttribute("data-disabled"), "true");
});
test("web missing media keeps generated fallback title", () => {
  const doc = render(WebCard, { data: { id: "42", title, media: { title } } });
  assert.equal(doc.querySelector('[aria-label="Feed flyer title"]').textContent, title);
});

test("feed link reaches the Next id route and resolves that exact event", () => {
  const doc = render(WebCard, { data: { id: "42", slug: "colliding-title", title, media: { title } } });
  const href = doc.querySelector("a").getAttribute("href");
  assert.equal(href, "/feed/events/42");
  const route = source("apps/web/src/app/(frontend)/feed/events/[id]/page.tsx");
  assert.match(route, /@dvnt\/app\/features\/events\/event-detail\.web/);
  assert.match(route, /m\.EventDetailScreen/);
  const detail = source("packages/app/features/events/event-detail.web.tsx");
  const idParam = detail.match(/const idParam = [^;]+;/)?.[0];
  const directId = detail.match(/const directId = [\s\S]*?;/)?.[0];
  const resolvedId = detail.match(/const resolvedId =[\s\S]*?;/)?.[0];
  assert.ok(idParam && directId && resolvedId, "production detail id resolution must exist");
  const { resolve } = loadSource("scripts/feed-route-contract-fixture.ts", `
    export function resolve(params: { id?: string; slug?: string }) {
      const slug = params.slug ?? "";
      const tokenEvent = { id: 901 };
      const listEvent = { id: 902 };
      const slugIndex = [];
      const resolveEventByPathSegment = () => ({ id: 903 });
      ${idParam}
      ${directId}
      ${resolvedId}
      return resolvedId;
    }
  `);
  assert.equal(resolve({ id: href.split("/").at(-1) }), 42, "stable id wins over slug/token collisions");
  assert.match(detail, /useEvent\(resolvedId \? String\(resolvedId\) : ""\)/);
});

test("mounted production card clicks route images and videos to the exact event", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://example.test/feed" });
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  const navigationAdapter = adapters["solito/navigation"].useRouter;
  const navigations = [];
  adapters["solito/navigation"].useRouter = () => ({ push: (href) => navigations.push(href) });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = dependency("react-dom/client");
  const rootNode = createRoot(document.querySelector("#root"));
  try {
    for (const kind of ["image", "video"]) {
      await React.act(async () => rootNode.render(React.createElement(WebCard, { data: {
        id: "42", slug: "conflicting-event", title,
        media: { title, ...(kind === "video" ? { videoFlyerUrl: "https://example.test/flyer.mp4" } : { staticFlyerUrl: "https://example.test/flyer.png" }) },
      } })));
      const link = document.querySelector('a[href="/feed/events/42"]');
      assert.ok(link);
      for (const target of [link.querySelector("h3"), link.querySelector(kind === "video" ? "video" : "img")]) {
        const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
        await React.act(async () => target.dispatchEvent(click));
        assert.ok(click.defaultPrevented, "plain click is intercepted for client navigation");
      }
    }
    assert.deepEqual(navigations, Array(4).fill("/feed/events/42"));
  } finally {
    await React.act(async () => rootNode.unmount());
    adapters["solito/navigation"].useRouter = navigationAdapter;
    for (const key of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
      else delete globalThis[key];
    }
    dom.window.close();
  }
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
          window.navigations = [];
          const root = createRoot(document.querySelector("main"));
          const onHeightChange = (id,width,height) => window.measurements.push({id,width,height});
          window.renderCard = data => { window.measurements = []; root.render(React.createElement(FeedEventCard, {data,onHeightChange})); };
        `, resolveDir: root, loader: "tsx" },
        bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
        nodePaths: [path.dirname(require.resolve("react/package.json", { paths: dependencyRoots })) + "/.."],
        plugins: [{ name: "feed-test-adapters", setup(builder) {
          builder.onResolve({ filter: /^(solito\/navigation|lucide-react|@dvnt\/app\/lib\/color\/useEventDominantColor|@dvnt\/app\/lib\/theme)$/ }, args => ({ path: args.path, namespace: "test-stub" }));
          builder.onLoad({ filter: /.*/, namespace: "test-stub" }, args => ({ contents:
            args.path === "solito/navigation" ? "export const useRouter = () => ({push(path){ window.navigations.push(path); }});" :
            args.path === "lucide-react" ? 'import React from "react"; const Icon=()=>React.createElement("i",{style:{display:"inline-block",width:10,height:10}}); export const MapPin=Icon,Clock=Icon,Users=Icon,Calendar=Icon,Zap=Icon;' :
            args.path.endsWith("useEventDominantColor") ? 'export const useEventDominantColor=()=>({color:"#111111"});' :
            'export const color={inkDeep:"#080a12",violet:"#8a40cf",text:"#ffffff"};', loader: "js", resolveDir: root }));
          builder.onResolve({ filter: /^@dvnt\/app\// }, args => ({ path: path.join(root, "packages/app", args.path.replace("@dvnt/app/", "")) + (args.path.endsWith(".web") ? ".tsx" : ".ts") }));
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
          const card = document.querySelector('a[href^="/feed/events/"]');
          const media = card.children[0].getBoundingClientRect();
          const footer = card.children[1];
          const details = footer.getBoundingClientRect();
          const top = footer.children[0].getBoundingClientRect();
          const headerItems = [...footer.children[0].children].filter((node) => node.textContent.trim()).map((node) => {
            const box = node.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, height: box.height };
          });
          const bottom = footer.children[1].getBoundingClientRect();
          return { measured: window.measurements.at(-1), width: outer.getBoundingClientRect().width, height: outer.getBoundingClientRect().height, mediaBottom: media.bottom, detailsTop: details.top, detailsBottom: details.bottom, footerHeight: details.height, headerHeight: top.height, headerItems, topBottom: top.bottom, bottomTop: bottom.top, bottomBottom: bottom.bottom, mediaWidth: media.width, mediaHeight: media.height, footerScrollHeight: footer.scrollHeight, footerClientHeight: footer.clientHeight };
        });
        const label = `${fixture.name} at ${width}px`;
        assert.ok(Math.abs(geometry.measured.height - geometry.height) < 0.5, `height callback disagrees with rendered card: ${label}`);
        assert.ok(Math.abs(geometry.measured.width - geometry.width) < 0.5, `width callback disagrees with rendered card: ${label}`);
        const { feedEventCardMeasurementKey } = loadSource("packages/app/components/event/feed-event-card-shape.ts");
        assert.equal(feedEventCardMeasurementKey("event", width), feedEventCardMeasurementKey("event", geometry.measured.width), `packer and DOM measurement keys differ: ${label}`);
        assert.ok(Math.abs(geometry.height - (geometry.mediaHeight + geometry.footerHeight + 24)) < 1, `unexpected blank outer area: ${label}`);
        assert.ok(Math.abs(geometry.mediaWidth / geometry.mediaHeight - 4 / 6) < 0.001);
        assert.ok(Math.abs(geometry.mediaBottom - geometry.detailsTop) < 0.5, "footer starts immediately after artwork");
        const gap = geometry.bottomTop - geometry.topBottom;
        assert.ok(gap >= -0.5 && gap <= 8.5, `footer gap ${gap}px must be compact: ${label}`);
        assert.ok(geometry.headerHeight <= 28, `category/date header is too tall: ${label}`);
        for (const item of geometry.headerItems) {
          assert.ok(item.height <= 28, `header badge is too tall: ${label}`);
          assert.ok(geometry.bottomTop - item.bottom <= 12.5, `visible blank space below a header badge: ${label}`);
        }
        assert.ok(geometry.detailsBottom - geometry.bottomBottom <= 14.5, `excessive footer bottom padding: ${label}`);
        assert.ok(geometry.bottomBottom <= geometry.detailsBottom, `footer content clipped: ${label}`);
        assert.ok(geometry.footerScrollHeight <= geometry.footerClientHeight + 1, `footer content overflows: ${label}`);
        if (fixture.name === "short") assert.ok(geometry.footerHeight <= 128, `short footer is unnecessarily tall: ${label}`);
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
      // Route by the exact event id, never by a title slug that may collide.
      for (const kind of ["image", "video"]) {
        if (kind === "video") await page.route("https://example.test/flyer.mp4", () => {});
        await page.evaluate(({ svg, kind }) => window.renderCard({
          id: "42", slug: "another-event-with-the-same-title", title: "Tap this event",
          media: { title: "Tap this event", ...(kind === "video" ? { videoFlyerUrl: "https://example.test/flyer.mp4" } : { staticFlyerUrl: svg }) },
        }), { svg, kind });
        const link = page.locator('a[href="/feed/events/42"]');
        await link.waitFor();
        await link.locator(kind === "video" ? "video" : "img").waitFor();
        assert.equal(await link.getAttribute("href"), "/feed/events/42");
        await page.evaluate(() => { window.navigations = []; });
        await link.locator("h3").click();
        await link.focus();
        await page.keyboard.press("Enter");
        await link.locator(":scope > div").first().scrollIntoViewIfNeeded();
        const media = await link.locator(":scope > div").first().boundingBox();
        assert.ok(media);
        await page.mouse.click(media.x + media.width / 2, media.y + media.height / 2);
        assert.deepEqual(await page.evaluate(() => window.navigations), ["/feed/events/42", "/feed/events/42", "/feed/events/42"], `${kind}: title, Enter, and media tap open this exact event`);
        await link.focus();
        await page.keyboard.press("Space");
        assert.equal(await page.evaluate(() => window.navigations.length), 3, "Space keeps native link semantics");
        // A modifier click must be left to the real href rather than router.push.
        await page.evaluate(() => {
          const link = document.querySelector('a[href="/feed/events/42"]');
          document.addEventListener("click", event => event.preventDefault(), { once: true });
          link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
        });
        assert.equal(await page.evaluate(() => window.navigations.length), 3, "modified click does not hijack browser navigation");
      }
    } finally { await browser.close(); }
  });
}
