/**
 * Every rail destination must also be an app surface.
 *
 * `app-shell.web.tsx` decides where the rail sends you; `site-chrome.tsx`
 * decides whether that destination keeps the app chrome or falls back to the
 * marketing site. They are two lists in two files, and nothing connected them —
 * so a route can be in the rail and absent from APP_SURFACES, which means a
 * signed-in user clicks a rail row and lands on the public site, complete with
 * a "Login" button.
 *
 * That has now happened twice: site-chrome's own comment records the /blog fix,
 * and /game-night arrived the same way when it moved out of /feed. `verify:routes`
 * does not catch it, because the route genuinely exists — it is the chrome that
 * is wrong, not the URL.
 *
 * Source text rather than imports: both files are `'use client'` TSX pulling in
 * React, solito and lucide, none of which `node --test` can load. The lists are
 * plain literals, so reading them is exact enough to fail when one drifts.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../..");

const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function railHrefs(): string[] {
  const src = read("packages/app/components/app-shell.web.tsx");
  return [...src.matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]!);
}

function appSurfaces(): string[] {
  const src = read("apps/web/src/components/site-chrome.tsx");
  const block = /const APP_SURFACES = \[([^\]]*)\]/.exec(src);
  assert.ok(block, "APP_SURFACES literal not found in site-chrome.tsx");
  return [...block[1]!.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]!);
}

/** Mirrors site-chrome's own `isAppSurface`. */
const covered = (href: string, surfaces: string[]) =>
  surfaces.some((p) => href === p || href.startsWith(p + "/"));

test("both lists are readable and non-empty", () => {
  assert.ok(railHrefs().length > 0, "no rail hrefs parsed");
  assert.ok(appSurfaces().length > 0, "no app surfaces parsed");
});

test("every rail destination keeps the app chrome", () => {
  const surfaces = appSurfaces();
  const orphans = railHrefs().filter((h) => h !== "/" && !covered(h, surfaces));
  assert.deepEqual(
    orphans,
    [],
    `rail rows missing from APP_SURFACES in apps/web/src/components/site-chrome.tsx: ${orphans.join(", ")}. ` +
      "A signed-in user clicking these lands on the marketing site.",
  );
});

test("game night specifically, the route this test was written for", () => {
  assert.ok(
    covered("/game-night", appSurfaces()),
    "/game-night must be an APP_SURFACE — it is a rail destination",
  );
});
