/**
 * Shared helpers for the authenticated specs (P13 WS-3..WS-7).
 *
 * Kept tiny and dependency-free on purpose: every authed spec reuses the
 * storage state minted by auth.setup.ts, so these helpers assume a session
 * already exists and only encode the two things every spec repeats — proving
 * the session survived navigation, and collecting page errors as a set.
 */

import { expect, type Page, type ConsoleMessage } from "@playwright/test";

/** Console noise that is not the app's fault; asserting against it would lie. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /\[Fast Refresh\]/i,
  /favicon\.ico/i,
  /net::ERR_BLOCKED_BY_CLIENT/i,
];

/**
 * Collect page errors and console errors for a per-test assertion. Returns the
 * live array — assert `expect(errors).toEqual([])` at the end so a failure
 * names every error on the page, not just the first.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (IGNORED_CONSOLE.some((r) => r.test(t))) return;
    errors.push(`console.error: ${t}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/**
 * Navigate to an authed route and prove the session carried: an unauthenticated
 * visitor is bounced to /auth/*, so staying on the target path IS the assertion.
 * Waits on `load`, never `networkidle` (next dev holds an HMR socket open).
 */
export async function gotoAuthed(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "load" });
  await expect(
    page,
    `expected to stay on ${path}, not be redirected to auth — session missing?`,
  ).not.toHaveURL(/\/auth\//);
  await expect(page.locator("body")).not.toBeEmpty();
}
