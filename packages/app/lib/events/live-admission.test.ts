import test from "node:test";
import assert from "node:assert/strict";
import { isLiveAdmission } from "./live-admission.ts";

test("live check-in feed uses authoritative tier purpose, never a misleading legacy stamp", () => {
  for (const category of ["service", "product", "coat_check", "unknown"]) {
    assert.equal(isLiveAdmission({category:"admission",ticket_type_id:"tier",ticket_types:{category}}),false);
  }
  assert.equal(isLiveAdmission({category:"admission",ticket_type_id:"tier",ticket_types:{category:"admission"}}),true);
  assert.equal(isLiveAdmission({category:"admission",ticket_type_id:"tier",ticket_types:[{category:"service"}]}),false);
  assert.equal(isLiveAdmission({category:"admission",ticket_type_id:"tier",ticket_types:null}),false);
});
test("known legacy admission continues; missing purpose remains unverified", () => {
  assert.equal(isLiveAdmission({category:"admission",ticket_type_id:null}),true);
  assert.equal(isLiveAdmission({category:"admission",ticket_type_id:"legacy-tier",ticket_types:{category:null}}),true);
  assert.equal(isLiveAdmission({}),false);
});
