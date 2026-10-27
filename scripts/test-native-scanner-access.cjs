const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadHelper(filename) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => loadHelper(path.resolve(path.dirname(filename), name)) });
  return exports;
}
const { scannerAccessGate } = loadHelper(path.resolve(__dirname, '../packages/app/lib/events/scanner-access.ts'));

function fixture() {
  const state = { auth: { _hasHydrated: true, isAuthenticated: true, user: { id: 'staff' } },
    role: { role: null, isLoading: false, isError: true }, retries: 0, backs: 0, routes: [] };
  const filename = path.resolve(__dirname, '../packages/app/features/routes/screens/(protected)/events/[id]/scanner.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const start = source.indexOf('function ScannerContent(');
  const end = source.indexOf('export default function TicketScannerScreen', start);
  const code = ts.transpileModule(`${source.slice(start,end)}\nexports.render = ScannerContent;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require, scannerAccessGate,
    View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    AlertTriangle: 'AlertTriangle', XCircle: 'XCircle', ScanLine: 'ScanLine',
    hasVisionCamera: true, ScannerWithCamera: 'CameraScanner',
    useRouter: () => ({ back: () => state.backs++, push: route => state.routes.push(route) }),
    useAuthStore: select => select(state.auth), useEvent: () => ({ data: {}, isLoading: false }),
    useEventRole: () => ({ ...state.role, refetch: () => { state.retries++; } }),
  });
  return { state, render: () => exports.render({ eventId: '7' }) };
}
function children(node) {
  if (node == null || typeof node === 'boolean') return [];
  if (Array.isArray(node)) return node.flatMap(children);
  if (typeof node !== 'object') return [node];
  return [node, ...children(node.props?.children)];
}
function text(node) { return children(node).filter(n => typeof n === 'string').join(' '); }
function button(node,label) { return children(node).find(n => n.type === 'Pressable' && text(n).includes(label)); }

test('native transient role failure renders retry, never staff refusal; retry can recover', () => {
  const f = fixture(); let tree = f.render();
  assert.match(text(tree), /Can't verify your door access/); assert.doesNotMatch(text(tree), /Not authorized/);
  button(tree,'Try again').props.onPress(); button(tree,'Try again').props.onPress();
  assert.equal(f.state.retries, 2); assert.equal(f.state.routes.length, 0);
  f.state.role = { role: null, isLoading: true, isError: false };
  assert.ok(children(f.render()).some(n => n.type === 'ActivityIndicator'));
  f.state.role = { role: 'scanner', isLoading: false, isError: false };
  tree = f.render(); assert.equal(tree.type, 'CameraScanner'); assert.equal(tree.props.eventId, '7');
});
test('native sign-out and confirmed refusal use separate messages without opening camera', () => {
  const f = fixture();
  f.state.auth.isAuthenticated = false;
  let tree = f.render(); assert.match(text(tree), /signed out/);
  button(tree,'Sign in').props.onPress(); assert.deepEqual(f.state.routes, ['/(auth)/login']);
  f.state.auth.isAuthenticated = true; f.state.role = { role: null, isLoading: false, isError: false };
  tree = f.render(); assert.match(text(tree), /Not authorized/); assert.equal(button(tree,'Try again'), undefined);
  button(tree,'Go Back').props.onPress(); assert.equal(f.state.backs, 1);
});
test('native lookup failure can close safely and fresh account cannot inherit scanner access', () => {
  const f = fixture(); button(f.render(),'Go Back').props.onPress(); assert.equal(f.state.backs, 1);
  f.state.auth.user = { id: 'new-account' }; f.state.role = { role: null, isLoading: true, isError: false };
  assert.ok(children(f.render()).some(n => n.type === 'ActivityIndicator'));
  f.state.role = { role: null, isLoading: false, isError: false };
  assert.match(text(f.render()), /Not authorized/);
});

test('native HTTP authorization failures are not treated as transient connectivity problems', () => {
  const f = fixture();
  f.state.role = { role: 'scanner', isLoading: false, isError: true, errorStatus: 403 };
  assert.match(text(f.render()), /Not authorized/);
  f.state.role.errorStatus = 401;
  assert.match(text(f.render()), /signed out/);
});

test('native scanner never logs bearer QR values or prefixes', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../packages/app/features/routes/screens/(protected)/events/[id]/scanner.tsx'), 'utf8');
  const ast = ts.createSourceFile('scanner.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isCallExpression(node) && /^console\.(log|warn|error)$/.test(node.expression.getText(ast))) {
      for (const arg of node.arguments) assert.doesNotMatch(arg.getText(ast), /\b(qrValue|qrToken)\b/, 'QR bearer value leaked to logs');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
});

test('native paused first role lookup asks to retry rather than claiming staff refusal', () => {
  const f = fixture(); f.state.role = { role: null, isLoading: false, isError: false, isPending: true, isPaused: true };
  assert.match(text(f.render()), /Can't verify your door access/);
  assert.ok(button(f.render(), 'Try again'));
});
