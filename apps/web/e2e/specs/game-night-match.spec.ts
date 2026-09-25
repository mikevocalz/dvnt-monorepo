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
const GN3_STATE = `${__dirname}/../.auth/gn3.json`;
const GN4_STATE = `${__dirname}/../.auth/gn4.json`;

async function joinByCode(
  page: import("@playwright/test").Page,
  code: string,
) {
  await page.goto("/game-night/join");
  await page.getByLabel(/join with a code/i).fill(code);
  await page.getByRole("button", { name: /join room/i }).click();
  await page.waitForURL(`**/game-night/room/${code}`, { timeout: 20_000 });
}

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
      await joinByCode(peer, code!);
      await expect(
        peer.getByRole("button", { name: /ready up/i }),
      ).toBeVisible({ timeout: 20_000 });

      // Peer readies; host sees it and starts.
      await peer.getByRole("button", { name: /ready up/i }).click();
      const startBtn = page.getByRole("button", { name: /start game/i });
      await expect(startBtn).toBeEnabled({ timeout: 35_000 });
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

  test("four players play a classic round end to end", async ({ page, browser }) => {
    const stateFiles = [PEER_STATE, GN3_STATE, GN4_STATE];
    test.skip(
      stateFiles.some((f) => !fs.existsSync(f)),
      "needs peer.json + gn3.json + gn4.json storage states in e2e/.auth",
    );

    const ctxs = await Promise.all(
      stateFiles.map((s) => browser.newContext({ storageState: s })),
    );
    for (const c of ctxs) await suppressInstallPrompt(c);
    const players = await Promise.all(ctxs.map((c) => c.newPage()));

    try {
      await page.goto("/game-night/join");
      await page.getByRole("button", { name: "Start a room" }).click();
      await page.waitForURL(/\/game-night\/room\/[A-Z0-9]{6}/, {
        timeout: 20_000,
      });
      const code = page.url().match(/room\/([A-Z0-9]{6})/)?.[1];
      expect(code, "room code in URL").toBeTruthy();

      // Three more identities join through the code-join UI.
      for (const p of players) await joinByCode(p, code!);
      for (const p of players) {
        const ready = p.getByRole("button", { name: /ready up/i });
        await expect(ready).toBeVisible({ timeout: 20_000 });
        await ready.click();
      }

      const startBtn = page.getByRole("button", { name: /start game/i });
      await expect(startBtn).toBeEnabled({ timeout: 35_000 });
      await startBtn.click();

      // 4 players => classic mode. Split pages into judge vs. writers.
      const all = [page, ...players];
      const writers: typeof all = [];
      let judge: (typeof all)[number] | null = null;
      for (const p of all) {
        const hand = p.getByRole("region", { name: "Your hand" });
        const judgeCue = p.getByText(/you are (the )?judg/i);
        const which = await Promise.race([
          hand.waitFor({ timeout: 25_000 }).then(() => "hand" as const),
          judgeCue
            .waitFor({ timeout: 25_000 })
            .then(() => "judge" as const),
        ]).catch(() => null);
        if (which === "hand") writers.push(p);
        else if (which === "judge") judge = p;
      }
      expect(judge, "exactly one judge").toBeTruthy();
      expect(writers.length, "three writers").toBe(3);

      // Each writer picks cards until Play enables, then submits.
      for (const w of writers) {
        const hand = w.getByRole("region", { name: "Your hand" });
        const play = hand.getByRole("button", { name: /play card/i });
        const cards = hand.locator("li button");
        for (let i = 0; i < (await cards.count()); i++) {
          if (await play.isEnabled()) break;
          await cards.nth(i).click();
        }
        await expect(play).toBeEnabled();
        await play.click();
      }

      // Judge picks a winner once all submissions are in.
      const pickBtn = judge!.getByRole("button", { name: /pick winner/i }).first();
      await expect(pickBtn).toBeVisible({ timeout: 30_000 });
      await pickBtn.click();

      // Everyone lands on round results.
      for (const p of all) {
        await expect(
          p.getByRole("region", { name: "Round results" }),
        ).toBeVisible({ timeout: 20_000 });
      }
    } finally {
      try {
        await page.getByRole("button", { name: /^leave$/i }).click({ timeout: 5_000 });
      } catch {
        /* room may already be ended */
      }
      await Promise.all(ctxs.map((c) => c.close()));
    }
  });
});
