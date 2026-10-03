import test from "node:test";
import assert from "node:assert/strict";
import {
  runEventMediaPreupload,
  type PreuploadDeps,
  type PreuploadItem,
  type PreuploadJobView,
} from "./event-media-preupload-run.ts";

type Jobs = Record<string, PreuploadJobView & Record<string, unknown>>;

function fakeDeps(jobs: Jobs, upload: PreuploadDeps["upload"]) {
  const banked: Array<[string, string]> = [];
  const deps: PreuploadDeps = {
    getJob: (uri) => jobs[uri],
    patch: (uri, values) => { jobs[uri] = { ...jobs[uri], ...values } as Jobs[string]; },
    persist: async (item) => item.uri,
    upload,
    bank: (item, url) => { banked.push([item.uri, url]); },
  };
  return { deps, banked };
}

const flyer: PreuploadItem = { uri: "file:///flyer.jpg", slot: "flyer", mediaType: "image" };
const photo: PreuploadItem = { uri: "file:///photo.jpg", slot: "gallery", mediaType: "image" };

test("an upload that finishes after the effect is cancelled still records its URL", async () => {
  // The hook's effect re-runs (and cancels the old run) whenever the picked
  // media changes, e.g. the organizer adds a photo while the flyer uploads.
  let cancelled = false;
  const jobs: Jobs = { [flyer.uri]: { state: "queued", attempts: 0 } };
  const { deps, banked } = fakeDeps(jobs, async () => {
    cancelled = true;
    return { success: true, url: "https://cdn.test/flyer.jpg" };
  });
  await runEventMediaPreupload([flyer], deps, () => cancelled);
  assert.equal(jobs[flyer.uri].state, "uploaded");
  assert.equal(jobs[flyer.uri].remoteUrl, "https://cdn.test/flyer.jpg");
  assert.deepEqual(banked, [[flyer.uri, "https://cdn.test/flyer.jpg"]]);
});

test("a failure after cancellation is recorded, not left as uploading", async () => {
  let cancelled = false;
  const jobs: Jobs = { [flyer.uri]: { state: "queued", attempts: 0 } };
  const { deps } = fakeDeps(jobs, async () => {
    cancelled = true;
    return { success: false, error: "413" };
  });
  await runEventMediaPreupload([flyer], deps, () => cancelled);
  assert.equal(jobs[flyer.uri].state, "failed");
});

test("cancellation stops the next upload from starting", async () => {
  let cancelled = false;
  const started: string[] = [];
  const jobs: Jobs = {
    [flyer.uri]: { state: "queued", attempts: 0 },
    [photo.uri]: { state: "queued", attempts: 0 },
  };
  const { deps } = fakeDeps(jobs, async (uri) => {
    started.push(uri);
    cancelled = true;
    return { success: true, url: `https://cdn.test/${started.length}` };
  });
  await runEventMediaPreupload([flyer, photo], deps, () => cancelled);
  assert.deepEqual(started, [flyer.uri]);
  assert.equal(jobs[photo.uri].state, "queued");
});

test("a job that failed twice is not retried automatically", async () => {
  const jobs: Jobs = { [flyer.uri]: { state: "failed", attempts: 2 } };
  let calls = 0;
  const { deps } = fakeDeps(jobs, async () => { calls += 1; return { success: true, url: "x" }; });
  await runEventMediaPreupload([flyer], deps, () => false);
  assert.equal(calls, 0);
});
