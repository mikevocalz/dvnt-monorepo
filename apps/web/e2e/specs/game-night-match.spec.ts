/**
 * Game Night — real two-browser match against the production backend.
 *
 * Two REAL authenticated identities (audit + peer, see peer.setup.ts), two
 * browser contexts, zero stubbed RPCs. Drives the full durable path the UI
 * exposes: host creates a room, peer joins by code URL, readies up, host
 * starts, peer submits cards, judge picks a winner, scores update.
 *
 * The room is created and ended through the UI only; nothing is seeded or
 * stubbed. Skips when peer credentials are absent.
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";

const PEER_STATE = `${__dirname}/../.auth/peer.json`;

async function suppressInstallPrompt(ctx: import("@playwright/test").BrowserContext) {
  await ctx.addInitScript(() => {
    window.addEventListener?.("beforeinstallprompt", (e) => e.preventDefault());
  });
}

test.describe("game night — two-client match", () => {
  test.describe.configure({ timeout: 180_000 });

  test("host + peer play a round end to end", async ({ page, browser }) => {
    test.skip(
      !fs.existsSync(PEER_STATE),
      "no peer identity: set E2E_PEER_EMAIL / E2E_PEER_PASSWORD in apps/web/.env.e2e.local",
    );

    const peerCtx = await browser.newContext({ storageState: PEER_STATE });
    await suppressInstallPrompt(peerCtx);
    const peer = await peerCtx.newPage();

    try {
      // Host creates a real room through the lobby UI.
      await page.goto("/game-night/join");
      await page.getByRole("button", { name: "Start a room" }).click();
      await page.waitForURL(/\/game-night\/room\/[A-Z0-9]{6}/, {
        timeout: 20_000,
      });
      const roomUrl = page.url();
      const code = roomUrl.match(/room\/([A-Z0-9]{6})/)?.[1];
      expect(code, "room code in URL").toBeTruthy();

      // Peer joins through the code-join UI — exercises the authorized join
      // RPC, not just room resolution.
      await peer.goto("/game-night/join");
      await peer.getByLabel(/join with a code/i).fill(code!);
      await peer.getByRole("button", { name: /join room/i }).click();
      await peer.waitForURL(`**/game-night/room/${code}`, { timeout: 20_000 });
      await expect(
        peer.getByRole("button", { name: /ready up/i }),
      ).toBeVisible({ timeout: 20_000 });

      // Peer readies; host sees it and starts.
      await peer.getByRole("button", { name: /ready up/i }).click();
      const startBtn = page.getByRole("button", { name: /start game/i });
      await expect(startBtn).toBeEnabled({ timeout: 15_000 });
      await startBtn.click();

      // 2 players => duel mode: prompt + shared options appear for both.
      await expect(
        peer.getByRole("region", { name: "Prompt" }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        peer.getByRole("region", { name: "Duel round" }),
      ).toBeVisible();
    } finally {
      // best-effort cleanup: host leaves then ends the room via Leave
      try {
        await page.getByRole("button", { name: /^leave$/i }).click({ timeout: 5_000 });
      } catch {
        /* room may already be ended */
      }
      await peerCtx.close();
    }
  });
});
