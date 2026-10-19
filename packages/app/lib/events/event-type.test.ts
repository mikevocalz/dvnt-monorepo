import assert from "node:assert/strict";
import test from "node:test";
import { EVENT_TYPE_OPTIONS, eventTypeLabel, eventTypeOptions, eventCardActionLabel, storedEventType, eventTypeUpdate, realtimeEventType } from "./event-type.ts";

test("canonical card labels use human names instead of raw identifiers", () => {
  assert.equal(EVENT_TYPE_OPTIONS.length, 27);
  for (const option of EVENT_TYPE_OPTIONS) assert.equal(eventTypeLabel(option.value), option.label);
  assert.equal(eventTypeLabel("game_night"), "Game Night");
  assert.equal(eventTypeLabel("party"), "Party");
  assert.equal(eventTypeLabel("other"), "Other");
  assert.equal(eventTypeLabel("music"), "Music");
  assert.equal(eventTypeLabel(null), "");
});
test("edit/reopen choices preserve legacy categories without changing unrelated edits", () => {
  for (const existing of ["music", "tech", "game_night", "other", ""]) {
    const choices = eventTypeOptions(existing);
    if (existing) assert.ok(choices.some(option => option.value === existing));
    assert.equal(new Set(choices.map(option => option.value)).size, choices.length);
    const selected = choices.find(option => option.value === "party")!;
    const reopened = eventTypeOptions(selected.value);
    assert.ok(reopened.some(option => option.value === "party"));
    assert.equal(reopened.length, 27);
  }
});
test("paid card CTA displays price, free uses RSVP, ended wins", () => {
  for (const price of [25, 35, 2, 12.5, 9.99]) assert.equal(eventCardActionLabel(price), `$${price}`);
  for (const price of [0, null, undefined, NaN, Infinity, -1]) assert.equal(eventCardActionLabel(price), "RSVP");
  assert.equal(eventCardActionLabel(25, true), "Ended");
  assert.equal(eventCardActionLabel(0, true), "Ended");
});

test("existing canonical type wins over broad category and explicit legacy edits clear stale type", () => {
  assert.equal(storedEventType({event_type:"party",category:"music"}),"party");
  assert.equal(storedEventType({event_type:null,category:"music"}),"music");
  assert.deepEqual(eventTypeUpdate("game_night"),{event_type:"game_night"});
  assert.deepEqual(eventTypeUpdate("music"),{event_type:null,category:"music"});
  assert.deepEqual(eventTypeUpdate(null),{event_type:null,category:null});
  const row = {event_type:"party",category:"music"};
  assert.equal(storedEventType({...row,...eventTypeUpdate("game_night")}),"game_night");
  assert.equal(storedEventType({...row,...eventTypeUpdate("music")}),"music");
});

test("realtime unrelated updates retain type while full rows prefer canonical and explicit clearing works",()=>{
  assert.equal(realtimeEventType({},"party"),"party");
  assert.equal(realtimeEventType({event_type:"party",category:"music"},"other"),"party");
  assert.equal(realtimeEventType({event_type:null,category:"music"},"party"),"music");
  assert.equal(realtimeEventType({event_type:null,category:null},"party"),undefined);
});
