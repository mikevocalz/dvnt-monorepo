const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load() {
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/profile-identity.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', source)(mod.exports, mod);
  return mod.exports;
}
const { identityColumns } = load();

test('omitted keys leave every identity column untouched', () => {
  assert.deepEqual(identityColumns({}), {});
});

test('the unfilled form a failed prefill used to send writes nothing', () => {
  assert.deepEqual(identityColumns({ gender: '', sexuality: [], eventAudience: '' }), {});
  assert.deepEqual(identityColumns({ gender: '   ', eventAudience: ' ' }), {});
});

test('null is a deliberate clear', () => {
  assert.deepEqual(identityColumns({ gender: null, sexuality: null, eventAudience: null }), {
    gender: null,
    sexuality: null,
    event_audience: null,
  });
});

test('real values are written, trimmed', () => {
  assert.deepEqual(identityColumns({ gender: ' Nonbinary ', sexuality: ['Queer'], eventAudience: 'Everyone' }), {
    gender: 'Nonbinary',
    sexuality: ['Queer'],
    event_audience: 'Everyone',
  });
});

test('update-profile builds its identity columns through identityColumns', () => {
  const src = fs.readFileSync(`${__dirname}/../update-profile/index.ts`, 'utf8');
  assert.match(src, /Object\.assign\(updateData, identityColumns\(updates\)\)/);
  assert.doesNotMatch(src, /updateData\.(gender|sexuality|event_audience)\s*=/);
});
