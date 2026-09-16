import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateAge, validateDateOfBirth } from "./age-verification.ts";
import { checkAdultBirthDate, verificationAgeDecision, checkAccountCreationAdmission } from "../../../../apps/mobile/supabase/functions/_shared/age-policy.ts";

const now = new Date("2026-09-16T00:00:00Z");

test("client and server agree at the 18th birthday boundary", () => {
  for (const [dob, allowed] of [["2008-09-16", true], ["2008-09-17", false], ["2008-09-15", true], ["2009-01-01", false]] as const) {
    assert.equal(checkAdultBirthDate(dob, now).allowed, allowed, dob);
    assert.equal(validateDateOfBirth(dob, now).isValid, allowed, dob);
  }
});

test("malformed, missing, rolled-over and future dates cannot pass", () => {
  for (const dob of ["", "2000-02-30", "2001-02-29", "2000-13-01", "2000-00-01", "2000-01-00", "2030-01-01", "2000-1-1", "September 1, 2000", "1900-01-01"]) {
    assert.equal(checkAdultBirthDate(dob, now).allowed, false, dob);
    assert.equal(validateDateOfBirth(dob, now).isValid, false, dob);
  }
  for (const dob of [undefined, null, 20000101, {}]) assert.equal(checkAdultBirthDate(dob, now).allowed, false);
});

test("leap-day adulthood is consistent and independent of host timezone", () => {
  for (const date of ["2026-02-28T23:59:59Z", "2026-03-01T00:00:00Z"]) {
    const at = new Date(date);
    assert.equal(checkAdultBirthDate("2008-02-29", at).allowed, date.includes("03-01"));
    assert.equal(validateDateOfBirth("2008-02-29", at).isValid, date.includes("03-01"));
  }
  assert.equal(calculateAge("09/16/2008", now), 18);
  assert.equal(calculateAge("02/30/2000", now), null);
});

test("provider approval requires adult document DOB evidence", () => {
  assert.equal(verificationAgeDecision("passed", "2008-09-16", now).status, "passed");
  assert.equal(verificationAgeDecision("passed", "2008-09-17", now).failureCode, "underage");
  for (const dob of [null, "", "2000-02-30", "2030-01-01"]) {
    assert.equal(verificationAgeDecision("passed", dob, now).status, "review");
  }
  for (const status of ["failed", "review", "submitted", "expired"]) {
    assert.equal(verificationAgeDecision(status, "2000-01-01", now).status, status);
  }
});

test("every new account requires an age-checked email signup context", () => {
  const body = { dateOfBirth: "2000-01-01", email: "MEMBER@example.com" };
  assert.equal(checkAccountCreationAdmission("/sign-up/email", body, "member@example.com").allowed, true);
  for (const path of ["/callback/google", "/sign-in/social", "/sign-in/phone-number", "/magic-link/verify", null, "/sign-up/other"]) {
    assert.equal(checkAccountCreationAdmission(path, body, "member@example.com").allowed, false);
  }
  assert.equal(checkAccountCreationAdmission("/sign-up/email", body, "someone-else@example.com").allowed, false);
  assert.equal(checkAccountCreationAdmission("/sign-up/email", undefined, "member@example.com").allowed, false);
});

test("unvalidated DOB and claimed admission flags cannot authorize an insert", () => {
  for (const body of [
    { email: "member@example.com", ageVerified: true },
    { email: "member@example.com", dateOfBirth: "2090-01-01" },
    { email: "member@example.com", dateOfBirth: "2000-02-30" },
  ]) {
    assert.equal(checkAccountCreationAdmission("/sign-up/email", body, "member@example.com").allowed, false);
  }
});
