import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { URL } from "node:url";

// Next requires directives before imports. TypeScript and component fixtures
// accept a misplaced string expression, so keep this compiler contract explicit.
for (const file of [
  "../activity/activity.web.tsx",
  "../messages/messages.web.tsx",
  "./screens/create.web.tsx",
  "./screens/room.web.tsx",
  "./ui/web/CohostInvites.tsx",
  "./ui/web/PreJoinSetup.tsx",
]) {
  test(`${file} keeps its client boundary before imports`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const firstStatement = source.replace(/^(?:(?:\s+)|(?:\/\*[\s\S]*?\*\/)|(?:\/\/[^\n]*(?:\n|$)))*/, "");
    assert.match(firstStatement, /^(?:"use client"|'use client');/, "Next client directive must precede every import or expression");
  });
}
