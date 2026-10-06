const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "stripe-processing-fee.ts"),
  "utf8",
);

assert.match(source, /latest_charge\.balance_transaction/);
assert.match(source, /balance_transaction/);
assert.match(source, /Number\(bt\.fee\)/);
assert.match(source, /processing_fee_cents/);
assert.match(source, /recompute_event_financials/);
assert.doesNotMatch(source, /0\.029|2\.9%|Math\.round\([^\n]*0\.0/);

console.log("stripe processing fee source contract: ok");
