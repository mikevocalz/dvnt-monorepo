/**
 * Auth setup — mints the storage state every other project reuses.
 *
 * Credentials come from `apps/web/.env.e2e.local` (gitignored) and are read
 * from the environment only; they are never written to a fixture, a trace, or
 * this file. P13 §2 forbids contacting any account other than the audit user
 * and `mikevocalz`, so this signs in as exactly one identity.
 *
 * The session is asserted, not assumed: a storage state saved from a failed
 * login produces an entire suite that fails somewhere far from the cause.
 */

import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const STATE = path.join(__dirname, "../.auth/audit.json");

setup("sign in as the audit account", async ({ page }) => {
  const email = process.env.E2E_AUDIT_EMAIL;
  const password = process.env.E2E_AUDIT_PASSWORD;

  // Fail loudly here rather than letting every downstream spec fail on a
  // redirect to /auth/login with no explanation.
  expect(
    email && password,
    "E2E_AUDIT_EMAIL / E2E_AUDIT_PASSWORD must be set — see apps/web/.env.e2e.local (docs/e2e/phase-0.md §4)",
  ).toBeTruthy();

  await page.goto("/auth/login");

  // Exact labels: a loose /password/i also matches the "Show password" toggle,
  // and a strict-mode violation there reads like a missing field.
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Password", { exact: true }).fill(password!);
  await page.getByRole("button", { name: /log ?in|sign ?in/i }).click();

  // Landing on the feed is the proof the session exists; waiting for a URL is
  // a real wait, unlike a timeout.
  await page.waitForURL(/\/feed(\/|$)/, { timeout: 30_000 });

  fs.mkdirSync(path.dirname(STATE), { recursive: true });
  await page.context().storageState({ path: STATE });
});
