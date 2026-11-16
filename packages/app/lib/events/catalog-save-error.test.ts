import test from "node:test";
import assert from "node:assert/strict";
import { catalogSaveNeedsReload } from "./catalog-save-error.ts";
test("uncertain persistence requires reload before another create", () => {
  for (const error of [new Error("Failed to fetch"),new Error("The creation was not confirmed"),{name:"AbortError"},{cause:new Error("Network request failed")}]) assert.equal(catalogSaveNeedsReload(error),true);
  for (const error of [new Error("Permission denied"),new Error("No row updated"),new Error("Variant validation failed"),null]) assert.equal(catalogSaveNeedsReload(error),false);
});
