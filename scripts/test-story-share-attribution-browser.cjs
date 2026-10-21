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
      /\.min-h-11/,
      "actual 44px footer hit-target utility must be built",
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
      const photo = { ...post, id: "103", url: flyer };
      const textEvent = { ...event, id: "104", url: undefined, sharedSource: {
        ...event.sharedSource,
        title: "A long original event title that wraps across multiple lines on a narrow story",
        caption: "A no-media event description that stays reachable. ".repeat(20),
      } };
      // The production overlay performs a new RLS read on every shared segment.
      // Return only these offline rows, never bypass the real API/guard.
      globalThis.__storyDb = (table) => ({
        error: null,
        data:
          table === "stories"
            ? [
                {
                  id: post.id,
                  expires_at: new Date(Date.now() + 3600000).toISOString(),
                  shared_source: post.sharedSource,
                  media: null,
                },
                {
                  id: textEvent.id,
                  expires_at: new Date(Date.now() + 3600000).toISOString(),
                  shared_source: textEvent.sharedSource,
                  media: null,
                },
                {
                  id: photo.id,
                  expires_at: new Date(Date.now() + 3600000).toISOString(),
                  shared_source: photo.sharedSource,
                  media: { url: photo.url, mime_type: "image/jpeg" },
                },
                {
                  id: event.id,
                  expires_at: new Date(Date.now() + 3600000).toISOString(),
                  shared_source: event.sharedSource,
                  media: { url: event.url, mime_type: "image/jpeg" },
                },
              ]
            : table === "users"
              ? [
                  {
                    id: author.id,
                    username: author.username,
                    first_name: "Original",
                    last_name: "Author",
                    avatar: { url: author.avatar },
                  },
                ]
              : [],
      });
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
      globalThis.__openStory = (kind, role = "other", tagged = false) => {
        f.useAuthStore.setState({ user: role === "guest" ? null : {
          id: role === "own" ? "2" : "1",
          authId: role === "own" ? "auth2" : "auth1",
          username: role === "own" ? "publisher" : "viewer",
        } });
        for (const id of ["101", "102", "103", "104"]) {
          f.client.setQueryData(["story-tags", id], tagged ? Array.from({ length: 8 }, (_, index) => ({
            id: `tag-${index}`, username: `tagged-member-${index}`, avatar,
          })) : []);
        }
        f.open([makeGroup(kind === "event" ? [event, post] : kind === "text-event" ? [textEvent, post] : kind === "photo" ? [photo, event] : [post, event])]);
      };
      globalThis.__openStory("post");
    });
    const actions = () => page.locator("[data-story-source-actions]");
    const sourceLink = () =>
      actions().getByRole("link", { name: /^View (Event|Post)$/ });
    const screenshots = process.env.STORY_SHARE_SCREENSHOT_DIR;
    if (screenshots) fs.mkdirSync(screenshots, { recursive: true });
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 375, height: 812 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const role of ["own", "other"]) {
        for (const kind of ["post", "photo", "event", "text-event"]) {
          await page.evaluate(({ kind, role }) => globalThis.__openStory(kind, role), { kind, role });
          await actions().waitFor();
          await page.mouse.move(0, 0);
          const geometry = await actions().evaluate((el) => {
            const rect = (e) => {
              if (!e) return null;
              const b = e.getBoundingClientRect();
              return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
            };
            const hit = (e) => {
              if (!e) return null;
              const b = e.getBoundingClientRect();
              return e.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
            };
            const source = el.querySelector("a");
            const style = getComputedStyle(el);
            const viewers = el.querySelector('button[aria-label="See who viewed this story"]');
            const footer = el.closest("[data-story-footer]");
            const frame = document.querySelector(".dvnt-story-viewer").parentElement;
            const content = document.querySelector('section[aria-label$=" content"]');
            return {
              actions: rect(el), source: rect(source), viewers: rect(viewers),
              footer: rect(footer), frame: rect(frame), content: rect(content),
              caption: rect(content?.querySelector("p")),
              reply: rect(document.querySelector('input[aria-label^="Reply to "]')?.closest("form")),
              reactions: [...document.querySelectorAll('button[aria-label^="React "]')].map(rect),
              sourceHit: hit(source), viewersHit: hit(viewers),
              actionCount: el.querySelectorAll("a, button").length,
              avatarCount: el.querySelectorAll("img").length,
              profileLinkCount: el.querySelectorAll('a[href^="/profile/"]').length,
              visibleText: el.textContent,
              background: style.backgroundColor,
              borderWidth: parseFloat(style.borderTopWidth),
              padding: parseFloat(style.paddingTop),
              bottomPadding: parseFloat(getComputedStyle(footer).paddingBottom),
            };
          });
          const context = `${kind}/${role}/${viewport.width}: ${JSON.stringify(geometry)}`;
          assert.ok(geometry.sourceHit, context);
          assert.equal(geometry.actionCount, role === "own" ? 2 : 1, "only the requested footer actions: " + context);
          assert.equal(geometry.avatarCount, 0, "no footer avatar: " + context);
          assert.equal(geometry.profileLinkCount, 0, "no third or hidden profile action: " + context);
          assert.equal(geometry.visibleText, `${role === "own" ? "Viewers" : ""}${kind.includes("event") ? "View Event" : "View Post"}`, "no author/name/title row: " + context);
          assert.equal(geometry.background, "rgba(0, 0, 0, 0)", "no surrounding card background: " + context);
          assert.equal(geometry.borderWidth, 0, "no surrounding card border: " + context);
          assert.equal(geometry.padding, 0, "no surrounding card padding: " + context);
          assert.ok(geometry.actions.left >= geometry.frame.left && geometry.actions.right <= geometry.frame.right, context);
          assert.ok(geometry.actions.top > geometry.frame.top + geometry.frame.height * 0.4, "source actions belong in the bottom area: " + context);
          assert.ok(Math.abs(geometry.footer.bottom - geometry.frame.bottom) <= 1, context);
          assert.ok(geometry.bottomPadding >= 20, "bottom safe-area baseline: " + context);
          assert.ok(geometry.source.height >= 44, context);
          assert.ok(geometry.actions.height <= 45, "single-row footer: " + context);
          assert.ok(geometry.source.right > geometry.frame.left + geometry.frame.width * 0.75, "source action must be on the right: " + context);
          assert.ok(geometry.source.bottom <= geometry.actions.bottom, context);
          assert.equal(await sourceLink().textContent(), kind.includes("event") ? "View Event" : "View Post");
          if (role === "own") {
            assert.ok(geometry.viewersHit, context);
            assert.ok(geometry.viewers.height >= 44 && geometry.viewers.width >= 44, context);
            assert.ok(Math.abs(geometry.viewers.top - geometry.source.top) <= 1, "actions share a bottom row: " + context);
            assert.ok(geometry.viewers.left < geometry.frame.left + geometry.frame.width * 0.25, "Viewers must be on the left: " + context);
            assert.ok(geometry.viewers.right < geometry.source.left, "actions cannot overlap: " + context);
            assert.equal(geometry.reply, null);
            assert.equal(geometry.reactions.length, 0);
          } else {
            assert.equal(geometry.viewers, null);
            assert.equal(geometry.reactions.length, 7);
            assert.ok(geometry.actions.bottom < geometry.reply.top, context);
            for (const reaction of geometry.reactions) {
              assert.ok(reaction.width >= 44 && reaction.height >= 44, "reactions never shrink: " + context);
              assert.ok(reaction.left >= geometry.frame.left && reaction.right <= geometry.frame.right, context);
              assert.ok(geometry.actions.bottom < reaction.top && reaction.bottom < geometry.reply.top, context);
            }
          }
          if (kind === "post" || kind === "text-event") {
            assert.ok(geometry.content.bottom < geometry.footer.top, "text remains in the body above the footer: " + context);
            assert.ok(geometry.content.height >= 80, "text body remains readable: " + context);
            assert.equal(await actions().getByText("A text post", { exact: false }).count(), 0);
          } else assert.equal(geometry.content, null);
          // The empty space between footer actions must not advance the player.
          await actions().click({ position: { x: geometry.actions.width / 2, y: geometry.actions.height / 2 } });
          assert.equal(await actions().getAttribute("aria-label"), `Shared ${kind.includes("event") ? "event" : "post"} by @original`);
          if (screenshots) await page.screenshot({ path: path.join(screenshots, `${kind}-${role}-${viewport.width}x${viewport.height}.png`) });
          if (role === "own") {
            await actions().getByRole("button", { name: "See who viewed this story" }).click();
            await page.getByRole("dialog", { name: "Story viewers" }).waitFor();
            assert.equal(await page.evaluate(() => globalThis.__viewersSheet.storyId), kind === "event" ? "102" : kind === "text-event" ? "104" : kind === "photo" ? "103" : "101");
            await page.getByRole("button", { name: "Close viewers" }).click();
          } else {
            await page.getByRole("textbox", { name: "Reply to publisher" }).fill("A draft reply");
            assert.equal(await page.getByRole("button", { name: /^React / }).count(), 0);
            assert.ok(await sourceLink().isVisible(), "composer focus preserves source access");
            await actions().click({ position: { x: geometry.actions.width / 2, y: geometry.actions.height / 2 } });
          }
          await sourceLink().focus();
          await page.keyboard.press("Enter");
          await actions().waitFor({ state: "detached" });
          assert.equal(await page.evaluate(() => globalThis.__routes.at(-1)), kind.includes("event") ? "/e/22" : "/feed/post/11");
          assert.equal(await page.evaluate(() => globalThis.__fixture.useStoryViewerStore.getState().navigationClose), true);
        }
        // Tag expansion does not shift or occlude the source action row.
        await page.evaluate((role) => globalThis.__openStory("text-event", role, true), role);
        await actions().waitFor();
        const before = await actions().boundingBox();
        await page.getByRole("button", { name: "8 people tagged" }).click();
        const tags = await page.locator("[data-story-tag-list]").boundingBox();
        const after = await actions().boundingBox();
        assert.deepEqual(after, before);
        assert.ok(tags.y >= 0 && tags.y + tags.height < after.y, "expanded tags stay above source actions");
        assert.ok(await sourceLink().isVisible());
        await page.getByRole("button", { name: "8 people tagged" }).click();
        const textBody = page.locator('section[aria-label="Shared event content"]');
        const textBox = await textBody.boundingBox();
        assert.ok(textBox.height >= 80, "long-title text event retains a readable body at " + viewport.width);
        await textBody.focus();
        await page.keyboard.press("End");
        await page.waitForFunction(() => document.querySelector('section[aria-label="Shared event content"]').scrollTop > 0);
        assert.equal(await actions().getAttribute("aria-label"), "Shared event by @original", "scroll keys must not advance the story");
        assert.equal(await page.locator("[data-story-tag-list]").count(), 0);
        await page.keyboard.press("Escape");
        await actions().waitFor({ state: "detached" });
      }
    }
    // The transparent middle still accepts ordinary next-segment clicks.
    await page.evaluate(() => globalThis.__openStory("event", "own"));
    await actions().waitFor();
    const frame = await page.locator(".dvnt-story-viewer").boundingBox();
    await page.mouse.click(frame.x + frame.width * 0.8, frame.y + frame.height * 0.5);
    await page.locator('[data-story-source-actions][aria-label="Shared post by @original"]').waitFor();
    // A signed-out account cannot retain the owner-only footer or sheet.
    await page.evaluate(() => globalThis.__openStory("event", "own"));
    await actions().getByRole("button", { name: "See who viewed this story" }).click();
    await page.evaluate(() => globalThis.__fixture.useAuthStore.setState({ user: null }));
    await page.getByRole("dialog", { name: "Story viewers" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("button", { name: "See who viewed this story" }).count(), 0);
    // A cached group's real player is not mounted until a fresh row is allowed.
    await page.evaluate(() => {
      globalThis.__allowedRpc = globalThis.__storyRpc;
      globalThis.__pending = [];
      globalThis.__storyRpc = (name, args) =>
        new Promise((resolve) =>
          globalThis.__pending.push({ name, args, resolve }),
        );
      globalThis.__openStory("post");
    });
    await page.getByRole("status").filter({ hasText: "Checking" }).waitFor();
    assert.equal(await page.locator(".dvnt-story-viewer").count(), 0);
    assert.equal(await actions().count(), 0);
    assert.equal(
      await page.locator('input[aria-label^="Reply to "]').count(),
      0,
    );
    await page.evaluate(() =>
      globalThis.__pending.at(-1).resolve({ data: null, error: null }),
    );
    await page
      .getByRole("status")
      .filter({ hasText: "no longer available" })
      .waitFor();
    assert.equal(await page.locator(".dvnt-story-viewer").count(), 0);
    await page.getByRole("button", { name: "Next story", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Checking" }).waitFor();
    assert.equal(await page.locator(".dvnt-story-viewer").count(), 0);
    assert.equal(
      await page.evaluate(() => globalThis.__pending.at(-1).args.p_story_id),
      102,
    );
    await page.evaluate(async () => {
      const pending = globalThis.__pending.at(-1);
      pending.resolve(
        await globalThis.__allowedRpc(pending.name, pending.args),
      );
    });
    await page
      .locator('section[aria-label="Shared event by @original"]')
      .waitFor();
    // The selected second segment stays selected after sanitization/remount.
    await page.waitForTimeout(100);
    assert.equal(
      await actions().getAttribute("aria-label"),
      "Shared event by @original",
    );
    assert.equal(await page.locator(".dvnt-story-viewer").count(), 1);
    assert.deepEqual(errors, []);
    console.log(
      "PASS story attribution Chromium: actual player, own/other/guest eligibility, 320/375/1440px unboxed two-action footer, Viewers left/source right, text/photo/event, seven 44px reactions, expanded tags, composer focus, hit-testing, keyboard and navigation-close semantics",
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
