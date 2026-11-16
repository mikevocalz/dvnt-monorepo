import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scriptReferencesTarget} from './release-test-targets.mjs';
const target = 'packages/app/lib/events/event-role.test.ts';
test('direct and quoted exact file targets are reachable', () => {
  for (const command of [`node --test ${target}`, `node --test "${target}"`, `node --test './${target}'`]) {
    assert.equal(scriptReferencesTarget(command, target), true);
  }
});
test('sibling tests and bare directories do not prove coverage', () => {
  for (const command of ['node --test packages/app/lib/events/other.test.ts', 'node --test packages/app/lib/events', `echo ${target}.bak`]) {
    assert.equal(scriptReferencesTarget(command, target), false);
  }
});
test('shell globs must actually include the target', () => {
  assert.equal(scriptReferencesTarget('node --test packages/app/lib/events/*.test.ts', target), true);
  assert.equal(scriptReferencesTarget('node --test "packages/app/**/*.test.ts"', target), true);
  assert.equal(scriptReferencesTarget('node --test packages/app/lib/events/*.test.cjs', target), false);
  assert.equal(scriptReferencesTarget('node --test packages/ui/**/*.test.ts', target), false);
});
