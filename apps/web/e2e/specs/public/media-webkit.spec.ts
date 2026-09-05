/**
 * WebKit-only checks (P13 §3): Safari's autoplay policy is the reason this
 * browser exists in the matrix. These run under the `webkit-media` project
 * (grep /@media/) and are signed-out, so they live beside the public smoke.
 */
import { test, expect } from "@playwright/test";

test("the login page renders in WebKit @media", async ({ page }) => {
  // Proves WebKit drives the real app, not just a blank launch. Login is the
  // simplest public route with no media dependency.
  const response = await page.goto("/auth/login", { waitUntil: "load" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("body")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: /sign ?in|log ?in/i }).first()).toBeVisible();
});
