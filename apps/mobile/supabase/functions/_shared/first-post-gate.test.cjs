const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load() {
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/first-post-gate.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', source)(mod.exports, mod);
  return mod.exports;
}
const { firstPostRefusal } = load();

test('only an approved adult record passes, whatever the admission policy says', () => {
  assert.equal(firstPostRefusal({ verificationState: 'approved' }), null);
  for (const state of ['not_started', 'pending', 'retry_required', 'rejected', null, undefined, 'Approved']) {
    assert.equal(firstPostRefusal({ verificationState: state })?.code, 'adult_verification_required');
  }
});

test('verification is checked before the event, so an unverified member learns the real reason', () => {
  assert.equal(
    firstPostRefusal({ verificationState: 'pending', eventVisibility: 'private' })?.code,
    'adult_verification_required',
  );
});

test('a non-public or unreadable event refuses the publish', () => {
  for (const eventVisibility of ['private', 'link_only', 'unlisted', null, '', 'Public']) {
    assert.equal(firstPostRefusal({ verificationState: 'approved', eventVisibility })?.code, 'event_not_public');
  }
  assert.equal(firstPostRefusal({ verificationState: 'approved', eventFound: false })?.code, 'event_not_public');
  assert.equal(firstPostRefusal({ verificationState: 'approved', eventVisibility: 'public' }), null);
});
