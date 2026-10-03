import test from "node:test";
import assert from "node:assert/strict";
import {
  editorialDisclosureA11y,
  editorialDisclosureLabel,
} from "./editorial-disclosure.ts";

test("an editorial post shows its trimmed label", () => {
  assert.equal(
    editorialDisclosureLabel({
      editorialJobId: "0b6d7c1e-0000-4000-8000-000000000001",
      disclosureLabel: "  DVNT Editorial · AI-assisted ",
    }),
    "DVNT Editorial · AI-assisted",
  );
});

test("a member post with a self-written label shows nothing", () => {
  assert.equal(
    editorialDisclosureLabel({ disclosureLabel: "DVNT Editorial" }),
    null,
  );
  assert.equal(
    editorialDisclosureLabel({ editorialJobId: "  ", disclosureLabel: "DVNT Editorial" }),
    null,
  );
});

test("a job id with a blank or missing label shows nothing", () => {
  assert.equal(editorialDisclosureLabel({ editorialJobId: "job" }), null);
  assert.equal(
    editorialDisclosureLabel({ editorialJobId: "job", disclosureLabel: "   " }),
    null,
  );
  assert.equal(
    editorialDisclosureLabel({ editorialJobId: "job", disclosureLabel: null }),
    null,
  );
});

test("the screen-reader text names the automation", () => {
  assert.match(editorialDisclosureA11y("DVNT Editorial"), /editorial automation/);
});
