#!/usr/bin/env node
// Production overlay + react-insta-stories + generated production Tailwind in
// Chromium. Network/auth are offline; playback hit-testing and geometry are real.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildFixture,
  buildStyles,
  load,
} = require("./story-share-attribution-fixture.cjs");
(async () => {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "story-attribution-browser-"),
  );
  let browser;
  try {
    await buildFixture({
      outfile: path.join(dir, "fixture.js"),
      browser: true,
    });
    const css = await buildStyles();
    assert.match(
      css,
      /\.bottom-40/,
      "actual card safe clearance utility must be built",
    );
    const { chromium } = load("playwright");
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox"],
    });
    const page = await browser.newPage({
      viewport: { width: 375, height: 812 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("https://fixture.invalid/**", (route) => route.abort());
    await page.setContent(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#06070d"><div id="root"></div></body></html>',
    );
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ path: path.join(dir, "fixture.js") });
    await page.evaluate(() => {
      const avatar =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#34A2DF"/><text x="25" y="53" fill="white" font-size="40">O</text></svg>',
        );
      const flyer =
        "data:image/svg+xml," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="540" height="960"><rect width="540" height="960" fill="#242555"/><circle cx="270" cy="480" r="180" fill="#8A40CF"/><text x="75" y="490" fill="white" font-size="50">DVNT EVENT</text></svg>',
        );
      const author = {
        id: "9",
        username: "original",
        name: "Original Author",
        avatar,
      };
      const post = {
        id: "101",
        type: "image",
        duration: 60000,
        sharedSource: {
          type: "post",
          id: "11",
          author,
          caption:
            "A text post from its original author. " +
            "This text stays inside the story card, with the original source always reachable. ".repeat(
              12,
            ),
        },
      };
      const event = {
        id: "102",
        type: "image",
        duration: 60000,
        url: flyer,
        sharedSource: {
          type: "event",
          id: "22",
          author,
          title: "The original event",
        },
      };
      const makeGroup = (items) => ({
        id: "101",
        userId: "2",
        username: "publisher",
        avatar,
        items,
        isViewed: false,
      });
      const f = globalThis.__fixture;
      const app = f.mount(document.getElementById("root"));
      app.render();
      globalThis.__openStory = (kind) =>
        f.open([makeGroup(kind === "event" ? [event, post] : [post, event])]);
      globalThis.__openStory("post");
    });
    const card = () => page.locator('section[aria-label^="Shared "]');
    const profile = () =>
      card().getByRole("link", { name: "View @original's profile" });
    const sourceLink = () =>
      card().getByRole("link", { name: /View original/ });
    const screenshots = process.env.STORY_SHARE_SCREENSHOT_DIR;
    if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const kind of ["post", "event"]) {
        await page.evaluate((kind) => globalThis.__openStory(kind), kind);
        await card().waitFor();
        await profile().waitFor();
        const geometry = await card().evaluate((el) => {
          const rect = (e) => {
            const b = e.getBoundingClientRect();
            return {
              left: b.left,
              right: b.right,
              top: b.top,
              bottom: b.bottom,
              width: b.width,
              height: b.height,
            };
          };
          const author = el.querySelector("a");
          const source = el.querySelectorAll("a")[1];
          const reply = document.querySelector(
            'input[aria-label^="Reply to "]',
          );
          const a = author.getBoundingClientRect(),
            s = source.getBoundingClientRect();
          return {
            card: rect(el),
            author: rect(author),
            source: rect(source),
            reply: rect(reply),
            authorHit: author.contains(
              document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2),
            ),
            sourceHit: source.contains(
              document.elementFromPoint(s.x + s.width / 2, s.y + s.height / 2),
            ),
            viewport: { w: innerWidth, h: innerHeight },
          };
        });
        assert.ok(geometry.authorHit, JSON.stringify(geometry));
        assert.ok(
          geometry.sourceHit,
          "source link must be above player tap catcher",
        );
        assert.ok(
          geometry.card.left >= 0 && geometry.card.right <= viewport.width,
          JSON.stringify(geometry),
        );
        assert.ok(
          geometry.source.bottom < geometry.reply.top,
          "reply controls cannot occlude source attribution",
        );
        assert.ok(
          geometry.author.height >= 36,
          "avatar/name have a usable click target",
        );
        assert.ok(
          geometry.source.bottom <= geometry.card.bottom,
          "source link stays inside short-screen card",
        );
        // Clicking card padding must not hit the player's next-segment surface.
        await card().click({ position: { x: 3, y: 3 } });
        assert.equal(
          await card().getAttribute("aria-label"),
          `Shared ${kind} by @original`,
        );
        if (screenshots)
          await page.screenshot({
            path: path.join(
              screenshots,
              `${kind}-${viewport.width}x${viewport.height}.png`,
            ),
          });
        await profile().click();
        await card().waitFor({ state: "detached" });
        assert.equal(
          await page.evaluate(() => globalThis.__routes.at(-1)),
          "/profile/original",
        );
        assert.equal(
          await page.evaluate(
            () =>
              globalThis.__fixture.useStoryViewerStore.getState()
                .navigationClose,
          ),
          true,
        );
        await page.evaluate((kind) => globalThis.__openStory(kind), kind);
        await sourceLink().waitFor();
        // Keyboard activation exercises the same proper anchor, not a decorative pill.
        await sourceLink().focus();
        await page.keyboard.press("Enter");
        await card().waitFor({ state: "detached" });
        assert.equal(
          await page.evaluate(() => globalThis.__routes.at(-1)),
          kind === "post" ? "/feed/post/11" : "/e/22",
        );
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "PASS story attribution Chromium: actual player, 320/375/1440px layouts, long text card, media event, author/source hit-testing above tap catcher, keyboard links, reply clearance and navigation-close semantics",
    );
  } finally {
    if (browser) await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
