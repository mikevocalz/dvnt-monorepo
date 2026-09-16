import test from "node:test";
import assert from "node:assert/strict";

import {
  buildUserSearchFilters,
  buildUserSearchTokens,
  userDisplayName,
} from "./user-search-query.ts";

test("one token is offered to username, first name and last name", () => {
  assert.deepEqual(buildUserSearchFilters("marquez"), [
    "username.ilike.%marquez%,first_name.ilike.%marquez%,last_name.ilike.%marquez%",
  ]);
});

test("a leading @ is stripped so @micah_marquez still hits the username", () => {
  assert.deepEqual(buildUserSearchTokens("@micah_marquez"), ["micah_marquez"]);
});

test("two tokens become two AND-ed groups, in either order", () => {
  const forward = buildUserSearchFilters("micah marquez");
  const reversed = buildUserSearchFilters("marquez micah");
  assert.equal(forward.length, 2);
  // Same two groups, so first+last and last+first select the same row.
  assert.deepEqual([...forward].sort(), [...reversed].sort());
  assert.ok(forward[0].includes("first_name.ilike.%micah%"));
  assert.ok(forward[1].includes("last_name.ilike.%marquez%"));
});

test("filter-grammar characters are dropped, not passed through", () => {
  const filters = buildUserSearchFilters("mi,ca(h)%_x");
  assert.deepEqual(filters, [
    "username.ilike.%micah_x%,first_name.ilike.%micah_x%,last_name.ilike.%micah_x%",
  ]);
  // One group per token, so exactly two commas — the grammar is intact.
  assert.equal(filters[0].split(",").length, 3);
  assert.ok(!filters[0].includes("("));
  // A bare wildcard cannot survive into the pattern and match everyone.
  assert.deepEqual(buildUserSearchFilters("%"), []);
});

test("a query under the minimum length returns no filters", () => {
  assert.deepEqual(buildUserSearchFilters("m", 2), []);
  assert.deepEqual(buildUserSearchFilters("   ", 2), []);
  assert.deepEqual(buildUserSearchFilters("", 1), []);
});

test("the row label prefers the full name", () => {
  assert.equal(userDisplayName("Micah", "Marquez", "micah_m"), "Micah Marquez");
  assert.equal(userDisplayName("Micah", null, "micah_m"), "Micah");
  assert.equal(userDisplayName(null, null, "micah_m"), "micah_m");
});
