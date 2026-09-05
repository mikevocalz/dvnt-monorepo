/**
 * RC product-id map sync test.
 *
 * Run:
 *   node --import tsx --test apps/mobile/supabase/__tests__/rc-product-map.sync.test.ts
 *
 * The revenuecat-webhook edge function is Deno (URL imports) so this TS
 * harness can't import it. It keeps a hand-mirrored copy of
 * RC_PRODUCT_TO_PLAN_KEY from packages/app/lib/subscription/plans.ts; this
 * test parses the map literal out of the Deno source and asserts it equals
 * the plans.ts-derived map, so the mirror can't drift silently. No DB
 * required — pure source-vs-source.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  PLAN_FAMILY,
  RC_PRODUCT_TO_PLAN_KEY,
} from "../../../../packages/app/lib/subscription/plans";

const here = path.dirname(fileURLToPath(import.meta.url));
const webhookSource = readFileSync(
  path.join(here, "../functions/revenuecat-webhook/index.ts"),
  "utf8",
);

function parseWebhookMapLiteral(name: string): Record<string, string> {
  const match = webhookSource.match(
    new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\};`),
  );
  assert.ok(
    match,
    `${name} literal not found in revenuecat-webhook/index.ts — ` +
      "renamed? Update this test alongside it.",
  );
  const out: Record<string, string> = {};
  for (const entry of match![1].matchAll(
    /["']?([\w:]+)["']?\s*:\s*["']([\w]+)["']/g,
  )) {
    out[entry[1]] = entry[2];
  }
  return out;
}

test("Deno-local RC product map mirrors plans.ts RC_PRODUCT_TO_PLAN_KEY", () => {
  const webhookMap = parseWebhookMapLiteral("RC_PRODUCT_TO_PLAN_KEY");
  assert.ok(
    Object.keys(webhookMap).length > 0,
    "parsed an empty map — regex out of date?",
  );
  assert.deepEqual(webhookMap, RC_PRODUCT_TO_PLAN_KEY);
});

test("Deno-local family map mirrors plans.ts PLAN_FAMILY", () => {
  const webhookFamilyMap = parseWebhookMapLiteral("FAMILY_BY_PLAN_KEY");
  assert.ok(
    Object.keys(webhookFamilyMap).length > 0,
    "parsed an empty family map — regex out of date?",
  );
  assert.deepEqual(webhookFamilyMap, PLAN_FAMILY);
});

test("webhook never hardcodes a product family at a call site", () => {
  // Every upsert must derive p_product_family from FAMILY_BY_PLAN_KEY (or
  // the source row's stored family in the TRANSFER cancel loop) — a literal
  // family at a call site is how sneaky purchases got mis-familied.
  assert.ok(
    !/p_product_family:\s*["']/.test(webhookSource),
    "revenuecat-webhook passes a hardcoded p_product_family literal",
  );
});

test("webhook derives plan_key via the normalizer, never verbatim", () => {
  // The old defect: `const planKey = ev.new_product_id ?? ev.product_id;`
  // passed Play's `dvnt_core:monthly` straight into the membership_plans FK.
  // Guard against the passthrough coming back.
  assert.ok(
    webhookSource.includes("planKeyFromRCProductId("),
    "revenuecat-webhook no longer calls planKeyFromRCProductId",
  );
  assert.ok(
    !/const planKey = ev\.new_product_id \?\? ev\.product_id;/.test(
      webhookSource,
    ),
    "identity passthrough of product_id as plan_key has returned",
  );
});
