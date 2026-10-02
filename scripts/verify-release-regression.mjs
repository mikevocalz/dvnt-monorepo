import { access, readFile } from "node:fs/promises";

const requiredFiles = [
  "packages/app/lib/auth/verified-admission.ts",
  "packages/app/lib/posts/publish-queue.test.ts",
  "packages/app/lib/stores/city-discovery-visibility.test.ts",
  "packages/app/lib/tickets/ticket-identity.test.ts",
  "apps/mobile/supabase/functions/create-event/index.test.cjs",
  "apps/mobile/supabase/functions/delete-event/index.test.cjs",
  "apps/mobile/supabase/functions/_shared/comp-recipients.test.cjs",
  "apps/mobile/supabase/functions/video_list_rooms/index.ts",
  "scripts/verify-edge-functions.mjs",
  "scripts/verify-issuance-invariants.mjs",
];

const contractPath = "docs/workstreams/17-release-regression-gate.md";
const requiredContractTerms = [
  "Private event E2E",
  "Age/verification",
  "Proximity/location",
  "Sneaky Lynk",
  "Account switching",
  "Release evidence",
];

const missing = [];
for (const file of requiredFiles) {
  try {
    await access(file);
  } catch {
    missing.push(file);
  }
}

const contract = await readFile(contractPath, "utf8");
const missingTerms = requiredContractTerms.filter((term) => !contract.includes(term));

if (missing.length || missingTerms.length) {
  if (missing.length) {
    console.error("Release gate is missing required executable coverage anchors:");
    for (const file of missing) console.error(` - ${file}`);
  }
  if (missingTerms.length) {
    console.error("Release contract lost required sections:");
    for (const term of missingTerms) console.error(` - ${term}`);
  }
  process.exit(1);
}

console.log(`Release regression contract OK: ${requiredFiles.length} executable anchors present.`);
