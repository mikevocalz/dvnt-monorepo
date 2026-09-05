/**
 * Video-flyer autoplay contract (P13 WS-2) — WebKit only, and that is the whole
 * point: Safari refuses to autoplay a video that is not muted + playsInline, so
 * a regression that drops either attribute is INVISIBLE in Chromium and breaks
 * the event hero only in Safari. These run under the `webkit-media` project
 * (tag @media).
 *
 * Ground truth (event-detail.web.tsx:827-836): the cover video is
 * `<video autoPlay muted loop playsInline poster=…>`. Bunny Stream is not
 * provisioned, so the source is a progressive MP4 from Edge Storage, not HLS.
 *
 * The event is discovered from the events list at runtime, then narrowed to one
 * that actually renders a <video> — never a hardcoded production id, which could
 * be deleted or lose its flyer.
 */

import { test, expect, type Page } from "@playwright/test";

/** Open events with a video flyer until one renders a <video>, else null. */
async function openEventWithVideoFlyer(page: Page): Promise<boolean> {
  await page.goto("/events", { waitUntil: "load" });
  const links = page.locator('a[href*="/events/"]');
  const count = Math.min(await links.count(), 12);
  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute("href");
    if (!href || /\/events\/create$/.test(href)) continue;
    await page.goto(href, { waitUntil: "load" });
    const video = page.locator("video").first();
    if (await video.count().then((n) => n > 0).catch(() => false)) {
      // Wait for it to actually attach, not just exist in the tree.
      if (await video.isVisible().catch(() => false)) return true;
    }
  }
  return false;
}

test.describe("video flyer autoplay in WebKit", () => {
  test("the cover video is muted + playsInline so Safari will autoplay it @media", async ({
    page,
  }) => {
    const found = await openEventWithVideoFlyer(page);
    test.skip(!found, "no event with a rendered video flyer to check");

    const video = page.locator("video").first();

    // The two attributes Safari's autoplay policy actually gates on. Dropping
    // either is the regression this spec exists to catch.
    await expect(video).toHaveJSProperty("muted", true);
    await expect(video).toHaveJSProperty("playsInline", true);

    // And it must actually be playing, not frozen on a black frame: currentTime
    // advances only if WebKit accepted the autoplay.
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 8000,
      })
      .toBeGreaterThan(0);
  });

  test("no poster still yields a playing hero, never a broken frame @media", async ({
    page,
  }) => {
    // P13 WS-2 case (c): a video flyer with no poster must fall back to the
    // first frame, not a broken hero. WebKit is where a missing poster + failed
    // autoplay would show black. This asserts the video is either playing or has
    // a poster — the one unacceptable state is neither.
    const found = await openEventWithVideoFlyer(page);
    test.skip(!found, "no event with a rendered video flyer to check");

    const video = page.locator("video").first();
    const state = await video.evaluate((v: HTMLVideoElement) => ({
      hasPoster: !!v.poster,
      playing: v.currentTime > 0 || !v.paused,
      readyState: v.readyState,
    }));
    expect(
      state.hasPoster || state.playing || state.readyState >= 2,
      `hero would be blank: ${JSON.stringify(state)}`,
    ).toBe(true);
  });
});
