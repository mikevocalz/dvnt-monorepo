/**
 * Visual check for the Cookout three.js table: drives a real 2-player duel
 * far enough to render the enhanced renderer, then captures the table for
 * comparison against the printed deck (Blue 100 — The Cookout).
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";

const PEER_STATE = `${__dirname}/../.auth/peer.json`;

async function joinByCode(
  page: import("@playwright/test").Page,
  code: string,
) {
  await page.goto("/game-night/join");
  await page.getByLabel(/join with a code/i).fill(code);
  await page.getByRole("button", { name: /join room/i }).click();
  await page.waitForURL(`**/game-night/room/${code}`, { timeout: 20_000 });
}

test.describe("game night — cookout table visuals", () => {
  test.describe.configure({ timeout: 180_000 });

  test("three.js card table renders in a live duel", async ({
    page,
    browser,
  }) => {
    test.skip(!fs.existsSync(PEER_STATE), "no peer identity");

    const peerCtx = await browser.newContext({ storageState: PEER_STATE });
    const peer = await peerCtx.newPage();

    try {
      await page.goto("/game-night/join");
      await page.getByRole("button", { name: "Start a room" }).click();
      await page.waitForURL(/\/game-night\/room\/[A-Z0-9]{6}/, {
        timeout: 20_000,
      });
      const code = page.url().match(/room\/([A-Z0-9]{6})/)?.[1];
      expect(code).toBeTruthy();

      await joinByCode(peer, code!);
      await peer
        .getByRole("button", { name: /ready up/i })
        .click({ timeout: 20_000 });
      const startBtn = page.getByRole("button", { name: /start game/i });
      await expect(startBtn).toBeEnabled({ timeout: 35_000 });
      await startBtn.click();

      // The enhanced renderer mounts a real WebGL canvas inside the table
      // section; the Skia fallback never produces a <canvas> element here.
      const table = page.getByRole("region", { name: "Table scene" });
      const canvas = table.locator("canvas");
      await expect(canvas).toBeVisible({ timeout: 30_000 });

      // Let fonts, the back texture and the deal animation settle.
      await page.waitForTimeout(2500);
      await table.screenshot({ path: "e2e/results/cookout-table-duel.png" });
      await page.screenshot({
        path: "e2e/results/cookout-room-duel.png",
        fullPage: true,
      });

      // The 3D table is clickable: tapping a fanned card locks the duel pick,
      // same action as the HTML option buttons.
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      const hits: Array<[number, number]> = [
        [0.2, 0.6],
        [0.8, 0.6],
        [0.35, 0.75],
        [0.65, 0.75],
      ];
      for (const [fx, fy] of hits) {
        await page.mouse.click(box!.x + box!.width * fx, box!.y + box!.height * fy);
        if (
          await page
            .getByRole("region", { name: "Duel round" })
            .getByText(/locked in/i)
            .isVisible()
            .catch(() => false)
        )
          break;
      }
      await expect(
        page.getByRole("region", { name: "Duel round" }).getByText(/locked in/i),
      ).toBeVisible({ timeout: 10_000 });

      // Chat toggles out of the table's way and reopens on demand — initial
      // state depends on viewport (open on lg+, collapsed below it).
      const chatInput = page.getByPlaceholder(/say something/i);
      const wasOpen = await chatInput.isVisible().catch(() => false);
      await page
        .getByRole("button", { name: /chat\s*(hide|show)/i })
        .click();
      if (wasOpen) await expect(chatInput).toBeHidden();
      else await expect(chatInput).toBeVisible();

      // Peer locks a pick so the submissions row + flip can be captured.
      const option = peer
        .getByRole("region", { name: "Duel round" })
        .getByRole("button")
        .first();
      await option.click({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      await table.screenshot({ path: "e2e/results/cookout-table-locked.png" });

      // Rules popover: opens from the header, closes cleanly.
      await page.getByRole("button", { name: /how to play/i }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(/Keep It 100/i);
      await page.screenshot({ path: "e2e/results/cookout-rules.png" });
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    } finally {
      try {
        await page
          .getByRole("button", { name: /end room/i })
          .click({ timeout: 5_000 });
      } catch {
        /* room may already be ended */
      }
      await peerCtx.close();
    }
  });

  test("table frames correctly on a phone viewport", async ({ browser }) => {
    test.skip(
      !fs.existsSync(PEER_STATE) ||
        !fs.existsSync(`${__dirname}/../.auth/audit.json`),
      "no identities",
    );

    // Phone-sized contexts for both seats — the enhanced renderer must fit
    // the felt, hand fan and seat rail without horizontal overflow.
    const hostCtx = await browser.newContext({
      storageState: `${__dirname}/../.auth/audit.json`,
      viewport: { width: 375, height: 812 },
    });
    const peerCtx = await browser.newContext({ storageState: PEER_STATE });
    const page = await hostCtx.newPage();
    const peer = await peerCtx.newPage();

    try {
      await page.goto("/game-night/join");
      await page.getByRole("button", { name: "Start a room" }).click();
      await page.waitForURL(/\/game-night\/room\/[A-Z0-9]{6}/, {
        timeout: 20_000,
      });
      const code = page.url().match(/room\/([A-Z0-9]{6})/)?.[1];
      expect(code).toBeTruthy();

      await joinByCode(peer, code!);
      await peer
        .getByRole("button", { name: /ready up/i })
        .click({ timeout: 20_000 });
      const startBtn = page.getByRole("button", { name: /start game/i });
      await expect(startBtn).toBeEnabled({ timeout: 35_000 });
      await startBtn.click();

      const table = page.getByRole("region", { name: "Table scene" });
      await expect(table.locator("canvas")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500);

      // The scene must not push the page wider than the viewport.
      const docW = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(docW).toBeLessThanOrEqual(376);

      // On a phone the chat starts collapsed — it must never cover the table.
      await expect(page.getByPlaceholder(/say something/i)).toBeHidden();
      await page.getByRole("button", { name: /chat\s*(hide|show)/i }).click();
      await expect(page.getByPlaceholder(/say something/i)).toBeVisible();

      await table.screenshot({ path: "e2e/results/cookout-table-mobile.png" });
    } finally {
      try {
        await page
          .getByRole("button", { name: /end room/i })
          .click({ timeout: 5_000 });
      } catch {
        /* room may already be ended */
      }
      await hostCtx.close();
      await peerCtx.close();
    }
  });
});
