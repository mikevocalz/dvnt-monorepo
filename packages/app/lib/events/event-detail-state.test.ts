import test from "node:test";
import assert from "node:assert/strict";
import { eventDetailIsResolving } from "./event-detail-state.ts";

const done = { isPending: false, isFetching: false };
const pending = { isPending: true, isFetching: true };
const disabled = { isPending: true, isFetching: false };
const input = {
  hasResolvedId: true,
  hasSlug: true,
  detail: done,
  isTokenRoute: false,
  token: disabled,
  list: done,
  index: done,
};

test("a missing or failed direct-ID detail query finishes instead of spinning", () => {
  assert.equal(eventDetailIsResolving(input), false);
  assert.equal(eventDetailIsResolving({ ...input, list: pending, index: pending }), false);
});

test("direct-ID initial loading and explicit retry remain loading", () => {
  assert.equal(eventDetailIsResolving({ ...input, detail: pending }), true);
  assert.equal(eventDetailIsResolving({ ...input, detail: { ...done, isFetching: true } }), true);
});

test("invalid or zero IDs with no slug never wait on disabled route queries", () => {
  assert.equal(eventDetailIsResolving({
    ...input, hasResolvedId: false, hasSlug: false,
    detail: disabled, token: disabled, index: disabled,
  }), false);
});

test("share-token resolution ignores the disabled slug index", () => {
  const route = { ...input, hasResolvedId: false, isTokenRoute: true, index: disabled, token: done };
  assert.equal(eventDetailIsResolving(route), false);
  assert.equal(eventDetailIsResolving({ ...route, token: pending }), true);
});

test("unresolved title slugs wait for the list/index but stop after empty/error answers", () => {
  const route = { ...input, hasResolvedId: false, detail: disabled };
  assert.equal(eventDetailIsResolving(route), false);
  assert.equal(eventDetailIsResolving({ ...route, list: pending }), true);
  assert.equal(eventDetailIsResolving({ ...route, index: pending }), true);
});
