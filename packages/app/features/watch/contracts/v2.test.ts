import { test } from "node:test";
import assert from "node:assert/strict";
import { epochSeconds, validateSendCommand } from "./v2";
import { watchAttachments } from "../watch-media";
import { toWatchDM, dmSignature } from "../watch-dm-payload";
import type { Conversation } from "@dvnt/app/lib/api/messages";

test("canonical time accepts seconds, milliseconds and ISO; rejects display time", () => {
  assert.equal(epochSeconds(1_788_566_400), 1_788_566_400);
  assert.equal(epochSeconds(1_788_566_400_000), 1_788_566_400);
  assert.equal(epochSeconds("2026-09-05T00:00:00Z"), Date.parse("2026-09-05T00:00:00Z") / 1000);
  for (const bad of [NaN, Infinity, -1, "5m ago", "Yesterday", "", null]) assert.equal(epochSeconds(bad), 0);
});
const command = { protocol: 2, accountGen: "a", operationId: "a20f6049-ab0f-49d2-8621-232571c4eed9", type: "dmReply", conversationId: "1", text: " Hello ", issuedAt: 100, expiresAt: 200 };
test("send boundary refuses stale, foreign, unknown, unbounded and malformed operations", () => {
  assert.equal(validateSendCommand(command, "a", ["1"], 150)?.text, "Hello");
  for (const patch of [{ accountGen: "old" }, { protocol: 1 }, { operationId: "" }, { conversationId: "2" }, { text: " " }, { text: "x".repeat(501) }, { expiresAt: 149 }, { issuedAt: Infinity }, { issuedAt: 181 }, { expiresAt: 90000 }]) {
    assert.equal(validateSendCommand({ ...command, ...patch }, "a", ["1"], 150), null, JSON.stringify(patch));
  }
});
test("metadata media stays in attachment order and never treats a video as a thumbnail", () => {
  const media = watchAttachments("m", { mediaItems: [{uri:"https://dvnt.b-cdn.net/a.jpg",type:"image"},{uri:"https://example.com/video.mp4",type:"video"},{uri:"file:///private/a",type:"image"}] });
  assert.equal(media.length, 2);
  assert.equal(media[0].id, "m:0");
  assert.match(media[0].thumbURL!, /width=384/);
  assert.equal(media[1].thumbURL, undefined);
  assert.equal(watchAttachments("m", { mediaUrl: "https://example.com/a.jpg" }).length, 1);
});
test("summary signature includes identity, canonical time and last message identity", () => {
  const c: Conversation = {id:"1",user:{id:"2",name:"A",username:"a",avatar:"https://example.com/a.jpg"},lastMessage:"same",timestamp:"5m ago",createdAt:"2026-09-05T00:00:00Z",lastMessageId:"10",unread:false};
  const before = dmSignature({ dms: [toWatchDM(c)], syncedAt: 1 });
  for (const changed of [{...c,lastMessageId:"11"},{...c,createdAt:"2026-09-05T00:01:00Z"},{...c,user:{...c.user,name:"B"}},{...c,user:{...c.user,avatar:"https://example.com/b.jpg"}}]) {
    assert.notEqual(dmSignature({dms:[toWatchDM(changed)],syncedAt:1}),before);
  }
  assert.equal(dmSignature({dms:[toWatchDM(c)],syncedAt:2}),before);
});
