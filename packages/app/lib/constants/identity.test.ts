import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { PRONOUN_OPTIONS } from "./identity.ts";

test("pronoun choices are exactly what update-profile accepts", () => {
  const source = readFileSync(
    new URL("../../../../apps/mobile/supabase/functions/update-profile/index.ts", import.meta.url),
    "utf8",
  );
  const block = source.split("const PRONOUN_VALUES = new Set([")[1].split("]);")[0];
  const server = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...PRONOUN_OPTIONS], server);
});

test("the editors import the shared list instead of keeping their own", () => {
  for (const path of [
    "../../features/profile/edit-profile.web.tsx",
    "../../features/routes/screens/(protected)/edit-profile.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /PRONOUN_OPTIONS/, path);
    assert.doesNotMatch(source, /PRONOUNS_OPTIONS|"Ze\/Zir"|Enter your pronouns/, path);
  }
});
