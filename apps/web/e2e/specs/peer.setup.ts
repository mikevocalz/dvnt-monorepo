/**
 * Peer auth setup — mints a SECOND storage state, for the specs that need two
 * real identities in one room.
 *
 * One account cannot stand in for two: `coPublishers` filters out our own peer
 * id and the roster filters out our own user id, so two tabs on one login see
 * nothing of each other and a two-client test would pass vacuously.
 *
 * SKIPS rather than fails when the credentials are absent — the rest of the
 * suite must keep running on a machine that only has the audit account. Set
 * E2E_PEER_EMAIL / E2E_PEER_PASSWORD in apps/web/.env.e2e.local (gitignored) to
 * turn the two-client specs on.
 */

import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const PEER_STATE = path.join(__dirname, "../.auth/peer.json");

setup("sign in as the peer account", async ({ page }) => {
  const email = process.env.E2E_PEER_EMAIL;
  const password = process.env.E2E_PEER_PASSWORD;
  setup.skip(
    !email || !password,
    "E2E_PEER_EMAIL / E2E_PEER_PASSWORD not set — two-client specs will skip",
  );

  await page.goto("/auth/login");
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();
  await page.waitForURL(/\/feed(\/|$)/, { timeout: 30_000 });

  // Two identities that resolve to the same user would silently recreate the
  // one-account problem this file exists to solve.
  const peerId = await page.evaluate(() => {
    try {
      const raw = localStorage.getItem("auth-store");
      return raw ? JSON.parse(raw)?.state?.user?.id ?? null : null;
    } catch {
      return null;
    }
  });
  expect(peerId, "could not read the peer's user id from the auth store").toBeTruthy();

  fs.mkdirSync(path.dirname(PEER_STATE), { recursive: true });
  await page.context().storageState({ path: PEER_STATE });
});
