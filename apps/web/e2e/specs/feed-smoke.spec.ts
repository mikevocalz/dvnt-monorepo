/**
 * Proves the storage state actually carries a session: /feed is behind auth,
 * so a signed-out visitor is bounced to /auth/login. Landing on /feed is the
 * assertion.
 */
import { test, expect } from "@playwright/test";

test("the audit session reaches the authed feed", async ({ page }) => {
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/feed(\/|$)/);
  await expect(page.locator("body")).not.toBeEmpty();
});
