import test from "node:test";
import assert from "node:assert/strict";
import {isHttpsEditorialSource, validateEditorialReview, type ReviewMutation} from "./review-gate.ts";

const approved: ReviewMutation = {
  previousStage: "review",
  nextStage: "approved",
  actorId: "staff-42",
  sourcePolicy: "verified-sources",
  sourceUrl: "https://example.org/source",
  channelEnabled: true,
  scheduledAt: "2026-11-01T13:00:00.000Z",
  publishOperationKey: "editorial:release:42",
};

test("a new record may start only as a draft", () => {
  assert.equal(validateEditorialReview({...approved,previousStage:null,nextStage:"draft"}), null);
  assert.equal(validateEditorialReview({...approved,previousStage:null,nextStage:"scheduled"}),"invalid_transition");
});

test("drafts cannot jump over review and human approval",()=>{
  assert.equal(validateEditorialReview({...approved,previousStage:"draft",nextStage:"scheduled"}),"invalid_transition");
  assert.equal(validateEditorialReview({...approved,previousStage:"draft",nextStage:"approved"}),"invalid_transition");
  assert.equal(validateEditorialReview({...approved,actorId:null}),"missing_reviewer");
});

test("unsourced factual news and history cannot be approved",()=>{
  for(const source of [null,"", "http://example.org/news", "javascript:alert(1)", "https://user:pass@example.org/source", "https://localhost/post"]){
    assert.equal(validateEditorialReview({...approved,sourceUrl:source}),"source_required");
    assert.equal(isHttpsEditorialSource(source),false);
  }
  assert.equal(validateEditorialReview(approved),null);
  assert.equal(validateEditorialReview({...approved,sourcePolicy:"entertainment",sourceUrl:null}),null);
});

test("only approved and enabled content with timing and operation ID may schedule",()=>{
  const scheduled: ReviewMutation = {...approved,previousStage:"approved",nextStage:"scheduled"};
  assert.equal(validateEditorialReview(scheduled),null);
  assert.equal(validateEditorialReview({...scheduled,channelEnabled:false}),"channel_disabled");
  assert.equal(validateEditorialReview({...scheduled,scheduledAt:null}),"schedule_required");
  assert.equal(validateEditorialReview({...scheduled,publishOperationKey:""}),"operation_required");
  assert.equal(validateEditorialReview({...scheduled,publishOperationKey:"editorial:release:42"}),null);
});

test("paused content can resume after a new approval-compatible eligibility read",()=>{
  assert.equal(validateEditorialReview({...approved,previousStage:"scheduled",nextStage:"paused"}),null);
  assert.equal(validateEditorialReview({...approved,previousStage:"paused",nextStage:"scheduled"}),null);
  assert.equal(validateEditorialReview({...approved,previousStage:"paused",nextStage:"scheduled",channelEnabled:false}),"channel_disabled");
});

test("no admin field update can falsely mark unpublished content as published",()=>{
  for(const from of ["draft","review","approved","scheduled","paused","rejected","published"] as const){
    assert.notEqual(validateEditorialReview({...approved,previousStage:from,nextStage:"published"}),null);
  }
});
