import test from "node:test";
import assert from "node:assert/strict";
import { loadEventRelationPages, eventWindowPage } from "./watch-event-pages";
test("old relationships remain available after several full pages", async () => {
  const rows = Array.from({length: 451}, (_, id) => ({id}));
  const ranges: number[][] = [];
  const result = await loadEventRelationPages(() => ({range: async (from,to) => {
    ranges.push([from,to]); return {data:rows.slice(from,to+1),error:null};
  }}));
  assert.deepEqual(result.data,rows);
  assert.deepEqual(ranges,[[0,199],[200,399],[400,599]]);
});
test("a failed later page cannot replace the prior snapshot with a partial archive", async () => {
  const error = new Error("Connection lost");
  const result = await loadEventRelationPages(() => ({range: async from => from === 0 ? {data:Array(200).fill(1),error:null} : {data:null,error}}));
  assert.equal(result.error,error); assert.deepEqual(result.data,[]);
});

test("archive pages remain bounded and reachable while keeping upcoming focus", () => {
  const rows = Array.from({length:131},(_,id)=>id);
  const first = eventWindowPage(rows,0);
  const second = eventWindowPage(rows,40);
  const last = eventWindowPage(rows,80);
  assert.equal(first.events.length,60);
  assert.equal(second.events.length,60);
  assert.deepEqual(second.events.slice(0,20),rows.slice(0,20));
  assert.deepEqual(second.events.slice(20),rows.slice(60,100));
  assert.equal(last.hasMore,false);
  assert.equal(last.hasPrevious,true);
  assert.equal(last.events.at(-1),130);
});
