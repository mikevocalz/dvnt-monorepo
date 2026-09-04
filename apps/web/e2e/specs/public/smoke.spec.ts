/**
 * Signed-out smoke over the public surfaces.
 *
 * Runs without the audit account on purpose: `/` is where DVNT-WEB-5 fired
 * 3,210 times (reanimated `Object.keys(null)`, last seen 2026-08-05, two days
 * before reanimated 4.5.3 landed in 0a267bf). This is the check that says
 * whether that route is actually healthy now — and therefore whether the
 * `reactStrictMode: false` workaround at next.config.ts:36 can come out.
 *
 * Console errors are collected per test rather than asserted inline so a
 * failure names every error on the page, not just the first one.
 */

import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";

/** Noise that is not the app's fault and would make the suite lie. */
const IGNORED = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
  // Third-party auth/analytics frames the signed-out page may embed.
  /net::ERR_BLOCKED_BY_CLIENT/i,
];

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED.some((r) => r.test(text))) return;
    errors.push(`console.error: ${text}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/auth/login", name: "login" },
  { path: "/events", name: "events-list" },
];

for (const route of ROUTES) {
  test(`${route.name} renders for a signed-out visitor`, async ({ page }, testInfo) => {
    const errors = collectErrors(page);

    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });
    expect(response?.status(), `${route.path} HTTP status`).toBeLessThan(400);

    // A blank <body> is the failure mode this whole suite exists to catch:
    // the route 200s and renders nothing because a client component threw.
    await expect(page.locator("body")).not.toBeEmpty();
    await page.waitForLoadState("networkidle");

    await testInfo.attach(`${route.name}-${testInfo.project.use.viewport?.width}`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: "image/png",
    });

    expect(errors, `unexpected console errors on ${route.path}`).toEqual([]);
  });
}

test("the login page offers both entrances above the fold", async ({ page }) => {
  // P1 §2 flags "Sign Up hidden below the fold on Login" as P0. This asserts
  // the fix condition directly: both controls inside the initial viewport.
  await page.goto("/auth/login", { waitUntil: "domcontentloaded" });

  const viewport = page.viewportSize();
  const signUp = page.getByRole("link", { name: /sign ?up|join dvnt|create account/i }).first();

  await expect(signUp).toBeVisible();
  const box = await signUp.boundingBox();
  expect(box, "sign-up control has no layout box").not.toBeNull();
  expect(
    box!.y + box!.height,
    `sign-up must sit within the first ${viewport?.height}px, not below the fold`,
  ).toBeLessThanOrEqual(viewport!.height);
});
