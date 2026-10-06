import test from "node:test";
import assert from "node:assert/strict";

import { promoterShareLink } from "../api/promoters.ts";
import { promoterEventLink } from "./promoter-share.ts";

test("copy and share use the same canonical tracked event URL", () => {
  const copied = promoterShareLink(90, "Ron");
  const shared = promoterEventLink("https://dvntapp.live/e/90", "Ron");

  assert.equal(copied, "https://dvntapp.live/e/90?ref=Ron");
  assert.equal(copied, shared);
});
