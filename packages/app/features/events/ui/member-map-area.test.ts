import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { savedMapArea } from './member-map-area.ts';
test('valid saved database city is only a labeled viewport', () => {
  assert.deepEqual(savedMapArea({ id: 2, name: 'Saved City', state: 'NY', lat: 42, lng: -75 }), { latitude: 42, longitude: -75, label: 'Saved City, NY' });
});
test('missing, synthetic device and invalid saved cities cannot establish a viewport', () => {
  assert.equal(savedMapArea(null), null);
  for (const city of [{ id: -1, name: 'Current location', lat: 42, lng: -75 }, { id: 2, name: 'Bad', lat: NaN, lng: -75 }, { id: 2, name: 'Bad', lat: 91, lng: 0 }]) assert.equal(savedMapArea(city), null);
});
