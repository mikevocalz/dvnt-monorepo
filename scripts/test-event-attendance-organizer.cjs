#!/usr/bin/env node
/** Actual draft/edit stores, draft API, and mounted web/native organizer controls.
 * No live requests. Native primitives are adapted to DOM; not device acceptance.
 * NODE_PATH=/tmp/dvnt-attendee-deps/node_modules node --test scripts/test-event-attendance-organizer.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const dependencyRoots = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), root];
const dependency = name => require(require.resolve(name, { paths: dependencyRoots }));
const ts = dependency('typescript');
const React = dependency('react');
const { JSDOM } = dependency('jsdom');
const { createRoot } = dependency('react-dom/client');
const cache = new Map();
const saved = new Map();
const requests = [];
let reply;
const adapters = {
  '@dvnt/app/lib/mmkv-zustand': { mmkvStorage: {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key),
  } },
  // Unrelated add-on creation is not exercised by attendee settings.
  '@dvnt/app/features/events/create/addon-form': { newDraftAddon: () => { throw new Error('Unexpected add-on edit'); } },
  './invoke-edge': { invokeEdge: async (name, body) => {
    assert.equal(name, 'event-drafts'); requests.push(body); return { data: reply, error: null };
  } },
  'react-native': {
    View: ({ children }) => React.createElement('div', null, children),
    Text: ({ children }) => React.createElement('span', null, children),
    Switch: ({ value, onValueChange, accessibilityLabel, accessibilityHint }) => React.createElement('input', {
      type: 'checkbox', role: 'switch', checked: value, 'aria-label': accessibilityLabel,
      'data-hint': accessibilityHint, onChange: event => onValueChange(event.target.checked),
    }),
  },
};
function sourceFile(stem) {
  for (const suffix of ['', '.ts', '.tsx']) if (fs.existsSync(stem + suffix) && fs.statSync(stem + suffix).isFile()) return stem + suffix;
  throw new Error(`Source not found: ${stem}`);
}
function load(file) {
  const filename = sourceFile(path.resolve(root, file));
  if (cache.has(filename)) return cache.get(filename);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  });
  assert.deepEqual(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error), [], `Syntax errors in ${file}`);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.require = name => {
    if (Object.hasOwn(adapters, name)) return adapters[name];
    if (name.startsWith('@dvnt/app/')) return load(path.join('packages/app', name.slice(10)));
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
    return dependency(name);
  };
  mod._compile(compiled.outputText, filename);
  cache.set(filename, mod.exports);
  return mod.exports;
}
const { useCreateEventStore: create } = load('packages/app/lib/stores/create-event-store.ts');
const { useEventEditStore: edit, eventAttendanceEditFields } = load('packages/app/lib/stores/event-edit-store.ts');
const { eventDraftsApi: drafts } = load('packages/app/lib/api/event-drafts.ts');
const { EventAttendanceField: WebField } = load('packages/app/components/event/event-attendance-field.web.tsx');
const { EventAttendanceField: NativeField } = load('packages/app/components/event/event-attendance-field.native.tsx');

test('new, legacy and malformed hydrated drafts stay off; explicit opt-in survives resume', async () => {
  create.getState().resetDraft();
  assert.equal(create.getState().showAttendees, false);
  for (const value of [undefined, null, false, 'true', 1, true]) {
    create.getState().loadServerDraft({ eventType: 'sex_party', showAttendees: value }, { id: 'draft', revision: 1 });
    assert.equal(create.getState().showAttendees, value === true);
    saved.set('create-event-draft', { state: { eventType: 'sex_party', showAttendees: value }, version: 0 });
    await create.persist.rehydrate();
    assert.equal(create.getState().showAttendees, value === true);
  }
  create.getState().setShowAttendees(true);
  assert.equal(saved.get('create-event-draft').state.showAttendees, true, 'partialize includes the opt-in');
  create.getState().resetDraft();
  assert.equal(create.getState().showAttendees, false);
});

test('changing an ordinary create draft to protected resets inherited consent', () => {
  for (const protect of [s => s.setEventType('sex_party'), s => s.setAttachLynkRoom(true)]) {
    create.getState().resetDraft();
    create.getState().setEventType('party');
    create.getState().setShowAttendees(true);
    protect(create.getState());
    assert.equal(create.getState().showAttendees, false);
    create.getState().setShowAttendees(true);
    assert.equal(create.getState().showAttendees, true, 'organizer can choose on after changing type/link');
  }
  create.getState().resetDraft();
  create.getState().setEventType('sex_party');
  create.getState().setShowAttendees(true);
  create.getState().setEventType('party');
  create.getState().setEventType('sex_party');
  assert.equal(create.getState().showAttendees, false, 'returning to protected is a new opt-in');
});

test('edit hydration and type changes cannot inherit opt-in from another event', () => {
  edit.getState().hydrate({ hydratedId: 'one', category: 'sex_party', showAttendees: true });
  assert.equal(edit.getState().showAttendees, true);
  edit.getState().hydrate({ hydratedId: 'two', category: 'sex_party' });
  assert.equal(edit.getState().showAttendees, false);
  edit.getState().hydrate({ hydratedId: 'three', category: 'party', showAttendees: true });
  edit.getState().setCategory('sex_party');
  assert.equal(edit.getState().showAttendees, false);
  edit.getState().setShowAttendees(true);
  assert.equal(edit.getState().showAttendees, true);
  edit.getState().hydrate({ hydratedId: 'linked', category: 'party', lynkRoomId: 'room', showAttendees: true });
  edit.getState().setCategory('virtual_session');
  assert.equal(edit.getState().showAttendees, true, 'already-protected linked event retains explicit choice');
  edit.getState().reset();
  assert.equal(edit.getState().showAttendees, false);
  assert.equal(edit.getState().lynkRoomId, null);
});

test('draft save includes opt-in; duplication resets it without breaking subsequent resume', async () => {
  create.getState().resetDraft();
  create.getState().setEventType('sex_party');
  create.getState().setShowAttendees(true);
  reply = { ok: true, draft: { id: 'draft', revision: 1, payload: { eventType: 'sex_party', showAttendees: true } } };
  await drafts.saveCurrent();
  assert.equal(requests.at(-1).payload.showAttendees, true);
  await drafts.duplicateEvent(12);
  assert.equal(create.getState().showAttendees, false, 'even an old duplicate response cannot carry consent');
  create.getState().setShowAttendees(true);
  await drafts.open('draft');
  assert.equal(create.getState().showAttendees, true, 'saved draft reload preserves explicit consent');
});

test('web autosave fingerprint changes when only attendee visibility changes', () => {
  const filename = path.join(root, 'packages/app/features/events/event-create.web.tsx');
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'fingerprint') expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression);
  const transpiled = ts.transpileModule(`module.exports = ${expression}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: null };
  new Function('module', transpiled)(mod);
  create.getState().resetDraft();
  const before = mod.exports(create.getState());
  create.getState().setShowAttendees(true);
  assert.notEqual(mod.exports(create.getState()), before);
});

test('mounted web and native controls show only protected events and preserve explicit toggle choices', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://fixture.invalid' });
  Object.assign(global, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  try {
    for (const Field of [WebField, NativeField]) {
      for (const [eventType, lynkRoomId, shown] of [
        ['sex_party', null, true], ['party', 'room', true], ['virtual_session', 'room', true],
        ['virtual_session', null, false], ['kink_fetish_party', null, false], ['bate_session', null, false], ['party', null, false],
      ]) {
        const element = document.createElement('div'); document.body.append(element);
        const view = createRoot(element);
        create.getState().resetDraft();
        create.getState().setEventType(eventType);
        create.getState().setAttachLynkRoom(Boolean(lynkRoomId));
        function Connected() {
          const s = create();
          return React.createElement(Field, { eventType: s.eventType, lynkRoomId: s.attachLynkRoom ? 'room' : null, showAttendees: s.showAttendees, onChange: s.setShowAttendees });
        }
        try {
          await React.act(async () => view.render(React.createElement(Connected)));
          const control = () => element.querySelector('[role="switch"]');
          assert.equal(Boolean(control()), shown, `${Field === WebField ? 'web' : 'native'} ${eventType} ${lynkRoomId}`);
          if (!shown) continue;
          assert.equal(control().getAttribute('aria-label'), 'Who’s Going');
          assert.equal(control().checked, false);
          assert.match(element.textContent, /eligible viewers who can access this event/);
          await React.act(async () => control().click());
          assert.equal(create.getState().showAttendees, true);
          assert.equal(control().checked, true);
          await React.act(async () => control().click());
          assert.equal(create.getState().showAttendees, false);
          assert.equal(control().checked, false);
        } finally {
          await React.act(async () => view.unmount()); element.remove();
        }
      }
    }
  } finally { dom.window.close(); }
});

test('every platform submit payload forwards only explicit attendee opt-in', () => {
  const cases = [
    ['packages/app/features/events/event-edit.web.tsx', 'updateData', 's'],
    ['packages/app/features/routes/screens/(protected)/events/create.tsx', 'eventData', 'showAttendees'],
    ['packages/app/features/routes/screens/(protected)/events/[id]/edit.tsx', 'updateData', 'showAttendees'],
    ['packages/app/features/routes/screens/(protected)/events/edit/[id].tsx', null, 'attendance'],
  ];
  for (const [file, variableName, binding] of cases) {
    const filename = path.join(root, file);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let property;
    const visit = node => {
      const object = variableName
        ? ts.isVariableDeclaration(node) && node.name.getText(source) === variableName ? node.initializer : null
        : ts.isPropertyAssignment(node) && node.name.getText(source) === 'updates' ? node.initializer : null;
      if (object && ts.isObjectLiteralExpression(object)) {
        property = object.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(source) === 'showAttendees') ?? property;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(property, `${file}: submit payload must include the setting`);
    const evaluate = new Function(binding, `return ${property.initializer.getText(source)};`);
    for (const value of [undefined, null, false, true, 'true', 1]) {
      assert.equal(evaluate(binding === 'showAttendees' ? value : { showAttendees: value }), value === true, `${file}: strict boolean payload`);
    }
  }
});


test('all editor hydration paths prefer raw fields, including explicit null, over stale aliases', () => {
  for (const event of [
    { event_type: 'sex_party', eventType: 'party', category: 'party', lynk_room_id: null, lynkRoomId: 'stale', show_attendees: null, showAttendees: true },
    { event_type: null, eventType: 'sex_party', category: 'party', lynk_room_id: 'current', lynkRoomId: null, show_attendees: false, showAttendees: true },
    { event_type: 'party', eventType: 'sex_party', category: 'sex_party', lynk_room_id: 'current', lynkRoomId: 'stale', show_attendees: true, showAttendees: false },
    { eventType: 'sex_party', lynkRoomId: 'normalized', showAttendees: true },
  ]) {
    const fields = eventAttendanceEditFields(event);
    const rawType = event.event_type !== undefined ? event.event_type : event.eventType;
    assert.equal(fields.category, typeof rawType === 'string' && rawType ? rawType : event.category ?? '');
    assert.equal(fields.lynkRoomId, event.lynk_room_id !== undefined ? event.lynk_room_id : event.lynkRoomId ?? null);
    assert.equal(fields.showAttendees, (event.show_attendees !== undefined ? event.show_attendees : event.showAttendees) === true);
    edit.getState().hydrate({ hydratedId: 'test', ...fields });
    assert.equal(edit.getState().showAttendees, fields.showAttendees);
    assert.equal(edit.getState().lynkRoomId, fields.lynkRoomId);
  }
  for (const file of [
    'packages/app/features/events/event-edit.web.tsx',
    'packages/app/features/routes/screens/(protected)/events/[id]/edit.tsx',
    'packages/app/features/routes/screens/(protected)/events/edit/[id].tsx',
  ]) {
    const filename = path.join(root, file);
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let sharedHydration = false;
    const visit = node => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'hydrate') {
        const object = node.arguments[0];
        sharedHydration = object && ts.isObjectLiteralExpression(object) && object.properties.some(p =>
          ts.isSpreadAssignment(p) && ts.isCallExpression(p.expression) && p.expression.expression.getText(source) === 'eventAttendanceEditFields');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(sharedHydration, true, `${file}: uses shared authoritative hydration`);
  }
});


test('native stale-save failure never restores identities after a newer realtime opt-out', async () => {
  const file = 'packages/app/features/routes/screens/(protected)/events/[id]/edit.tsx';
  const filename = path.join(root, file);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let mutationTry;
  let submit;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleSave') submit = node.initializer;
    if (ts.isTryStatement(node) && node.tryBlock.statements.some(statement =>
      ts.isExpressionStatement(statement) && ts.isAwaitExpression(statement.expression) &&
      ts.isCallExpression(statement.expression.expression) &&
      statement.expression.expression.expression.getText(source) === 'updateEventMutation.mutateAsync')) mutationTry = node;
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(mutationTry);
  assert.ok(submit);
  const forbiddenWrites = [];
  const inspect = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === 'queryClient' &&
      ['setQueryData', 'setQueriesData'].includes(node.expression.name.text)) forbiddenWrites.push(node.getText(source));
    ts.forEachChild(node, inspect);
  };
  inspect(submit);
  assert.deepEqual(forbiddenWrites, [], 'the shared mutation owns every optimistic write and rollback');
  const code = ts.transpileModule(`module.exports = async function () { ${mutationTry.getText(source)} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const initial = { id: 'event', category: 'sex_party', showAttendees: true, attendeeAvatars: [{ id: 'private-person' }], totalAttendees: 7 };
  let current = initial;
  let rejectSave;
  let invalidations = 0;
  const saving = [];
  const notices = [];
  const { sanitizeEventAttendance } = load('packages/app/lib/events/event-attendee-visibility.ts');
  const context = {
    id: 'event', updateData: { showAttendees: false },
    updateEventMutation: { mutateAsync: async () => {
      // Shared mutation performs the sanitized optimistic update, not the screen.
      current = sanitizeEventAttendance({ ...current, showAttendees: false });
      await new Promise((_, reject) => { rejectSave = reject; });
    } },
    queryClient: {
      invalidateQueries: () => { invalidations++; },
      setQueryData: () => { throw new Error('Screen must not restore its old snapshot'); },
      setQueriesData: () => { throw new Error('Screen must not duplicate optimistic cache writes'); },
    },
    showToast: (...args) => notices.push(args), setIsSaving: value => saving.push(value),
  };
  const mod = { exports: null };
  new Function('module', ...Object.keys(context), code)(mod, ...Object.values(context));
  const pending = mod.exports();
  assert.equal(current.attendeeAvatars.length, 0);
  // A later realtime opt-out owns the current row while the old request fails.
  current = sanitizeEventAttendance({ ...current, show_attendees: false, showAttendees: false });
  const realtimeRow = current;
  rejectSave(new Error('Old save failed'));
  await pending;
  assert.equal(current, realtimeRow);
  assert.equal(current.attendeeAvatars.length, 0);
  assert.equal(current.totalAttendees, 7);
  assert.equal(invalidations, 1);
  assert.deepEqual(saving, [false]);
  assert.equal(notices[0][1], 'Save Failed');
});
