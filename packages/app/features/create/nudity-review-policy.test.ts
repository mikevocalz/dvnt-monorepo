import test from "node:test";
import assert from "node:assert/strict";
import { needsSpicyReview, reviewFingerprint, videoSampleTimes } from "./nudity-review-policy.ts";

test("explicit classes trigger advisory at threshold; suggestive is not nudity", () => {
  for (const className of ["Porn", "Hentai"]) {
    assert.equal(needsSpicyReview([{ className, probability: 0.65 }]), true);
    assert.equal(needsSpicyReview([{ className, probability: 0.649 }]), false);
  }
  for (const className of ["Sexy", "Neutral", "Drawing"]) assert.equal(needsSpicyReview([{ className, probability: 0.99 }]), false);
  assert.equal(needsSpicyReview([]), false);
  assert.equal(needsSpicyReview([{ className: "Porn", probability: NaN }]), false);
});
test("video samples include start and late frames, invalid durations stay incomplete", () => {
  assert.deepEqual(videoSampleTimes(10), [0, 2.5, 5, 7.5, 9.8]);
  for (const duration of [0, -1, NaN, Infinity]) assert.deepEqual(videoSampleTimes(duration), []);
});
test("consent is tied to exact media, motion, edits and label", () => {
  const draft = { postKind: "media", isNSFW: false, selectedMedia: [{ id: "1", uri: "blob:1" }] };
  const fingerprint = reviewFingerprint(draft);
  assert.equal(fingerprint, reviewFingerprint(structuredClone(draft)));
  assert.notEqual(fingerprint, reviewFingerprint({ ...draft, isNSFW: true }));
  assert.notEqual(fingerprint, reviewFingerprint({ ...draft, postKind: "text" }));
  for (const change of [{ uri: "blob:2" }, { editedUri: "blob:3" }, { pairedVideoUri: "blob:motion" }, { originalUri: "blob:original" }, { editorOpened: true }, { kind: "livePhoto" }, { type: "video" }]) {
    assert.notEqual(fingerprint, reviewFingerprint({ ...draft, selectedMedia: [{ ...draft.selectedMedia[0], ...change }] }));
  }
});
