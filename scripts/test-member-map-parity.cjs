const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

// Exercise the real CLI/extractor/classifier, not a copied approximation.
function parity(native, web = 'export default function Screen() { return null; }') {
  const root = mkdtempSync(join(tmpdir(), 'member-map-parity-'));
  try {
    const dir = join(root, 'packages/app/features/fixture');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'map.tsx'), native);
    writeFileSync(join(dir, 'map.web.tsx'), web);
    const result = spawnSync(process.execPath,
      [resolve(__dirname, 'verify-port-parity.mjs'), '--json'],
      { cwd: root, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    // The intentionally minimal tree also lacks unrelated required screens.
    // Inspect this fixture's actual hard-failure report, not the process status.
    return JSON.parse(result.stdout).webDataDiffs.find(x => x.webRel === 'fixture/map.web.tsx');
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('Expo image presentation binding needs no matching web hook', () => {
  assert.equal(parity(`import { useImage } from 'expo-image'; const image = useImage(url);`), undefined);
  assert.equal(parity(`import { useImage as useAvatarImage } from "expo-image"; const image = useAvatarImage(url);`), undefined);
});
test('nearby and location settings remain required domain wiring', () => {
  const diff = parity(`import { useImage } from 'expo-image';
    import { useNearbyMembers, useLocationSettings } from './domain';
    useImage(url); useNearbyMembers(true); useLocationSettings();`);
  assert.deepEqual(diff.missDomain.sort(), ['useLocationSettings', 'useNearbyMembers']);
});
test('first-party useImage is not exempt, including beside aliased Expo binding', () => {
  for (const prefix of ['', `import { useImage as useAvatarImage } from 'expo-image'; useAvatarImage(url);`]) {
    const diff = parity(`${prefix} import { useImage } from './domain'; useImage();`);
    assert.deepEqual(diff.missDomain, ['useImage']);
  }
});

test('type-only Event import carries no runtime hook wiring; value imports still do', () => {
  assert.equal(parity(`import type { Event } from '@dvnt/app/lib/hooks/use-events'; const events: Event[] = [];`), undefined);
  const diff = parity(`import { useEvents } from '@dvnt/app/lib/hooks/use-events'; useEvents();`);
  assert.ok(diff.missHooks.includes('use-events'));
  assert.ok(diff.missDomain.includes('useEvents'));
});
