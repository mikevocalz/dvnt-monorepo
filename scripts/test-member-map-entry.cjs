const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = path => fs.readFileSync(path, 'utf8');
test('web Events entry owns automatic consent before map entry', () => {
 const source = read('packages/app/features/events/events-list.web.tsx');
 assert.match(source, /isAuthenticated\s*\?\s*<MapSharingConsent active promptOnly\s*\/>/);
});
test('native Events entry follows tab focus', () => {
 const source = read('packages/app/features/routes/screens/(protected)/(tabs)/events.tsx');
 assert.match(source, /const isFocused = useIsFocused\(\)/);
 assert.match(source, /<MapSharingConsent active=\{isFocused\} promptOnly\s*\/>/);
});
test('only entry surfaces auto-prompt; map retains manual controls', () => {
 for(const platform of ['', '.web']) {
  const source = read(`packages/app/features/events/ui/map-sharing-consent${platform}.tsx`);
  assert.match(source, /promptOnly = false/);
  assert.match(source, /useMapSharingPrompt\(owner, active, promptOnly\)/);
  assert.match(source, /!promptOnly/);
  assert.match(source, /Stop sharing/);
 }
});
