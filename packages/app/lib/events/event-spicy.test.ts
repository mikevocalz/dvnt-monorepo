import test from 'node:test';
import assert from 'node:assert/strict';
import { isSpicyEventType } from './event-spicy.ts';
test('all screenshot adult categories and existing taxonomy are Spicy', () => {
  for (const type of ['Bate session','Kink / Play Party','kink_fetish_party','Sex Party','Glory Hole','Cruising','Cum Dump']) assert.equal(isSpicyEventType(type), true, type);
  for (const type of ['party', 'pool_party', 'game_night', '', undefined, null]) assert.equal(isSpicyEventType(type), false);
});
