// Actual native auth effects/submission callbacks with synthetic service/router
// boundaries. No real email verification, recovery or account changes occur.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { create } = require('zustand');
const root = path.resolve(__dirname, '..');
function callbacks(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result = { effects: [] };
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect') result.effects.push(node.arguments[0].getText(ast));
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'onSubmit') result.submit = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); return result;
}
function bind(code, scope) {
  const js = ts.transpileModule('(' + code + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '');
  return new Function(...Object.keys(scope), 'return ' + js)(...Object.values(scope));
}
const timers = new Set();
const setTimeout = callback => { timers.add(callback); return callback; };
const clearTimeout = callback => timers.delete(callback);
const flush = async () => { const callbacks = [...timers]; timers.clear(); for (const callback of callbacks) await callback(); };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const auth = create(() => ({ user: { id: 'alice' }, isAuthenticated: true, authStatus: 'authenticated' }));
const statuses = [], navigation = [], toasts = [];
const base = { useAuthStore: auth, router: { replace: value => navigation.push(value) }, setStatus: value => statuses.push(value),
  setTimeout, clearTimeout, isFocused: true, params: { token: 'fixture-token' } };
const reset = () => { timers.clear(); statuses.length = 0; navigation.length = 0; toasts.length = 0; auth.setState({ user: { id: 'alice' }, isAuthenticated: true, authStatus: 'authenticated' }); };
(async () => {
  const verification = callbacks('packages/app/features/routes/screens/(auth)/verify-email.tsx').effects[0];
  let resolveVerification;
  const scope = { ...base, showToast: (...args) => toasts.push(args), submitEmailVerification: () => new Promise(resolve => { resolveVerification = resolve; }),
    authClient: { getSession: async () => ({ data: { user: { emailVerified: true } } }) } };
  let cleanup = bind(verification, scope)();
  resolveVerification({}); await tick(); assert.deepEqual(statuses, ['success']);
  cleanup(); await flush(); assert.deepEqual(navigation, [], 'leaving verify-email cancels its success timer');
  reset(); cleanup = bind(verification, scope)(); cleanup(); resolveVerification({}); await tick(); await flush();
  assert.deepEqual(statuses, [], 'late verification response after unmount cannot schedule a new timer');
  reset(); cleanup = bind(verification, { ...scope, params: {} })(); await tick(); await flush();
  assert.deepEqual(statuses, ['success']); assert.deepEqual(navigation, ['/(protected)/(tabs)'], 'session-only emitted callback completes verification'); cleanup();
  reset(); cleanup = bind(verification, scope)(); resolveVerification({}); await tick();
  auth.setState({ isAuthenticated: false, authStatus: 'unauthenticated' }); await flush();
  assert.deepEqual(navigation, [], 'status-only logout invalidates scheduled verification navigation'); cleanup();
  reset(); assert.equal(bind(verification, { ...scope, isFocused: false })(), undefined, 'inactive native auth screen cannot start a verification callback');
  console.log('PASS actual native email callback: token/session recovery, unmount, inactive screen, pending response and logout timer guards');

  const resetCallbacks = callbacks('packages/app/features/routes/screens/(auth)/reset-password.tsx');
  let resolveReset;
  const continuation = { current: { active: false, epoch: 0, timer: undefined } };
  const recoveryScope = { ...base, continuation, setIsSubmitting() {}, getSession: async () => ({ user: { id: 'alice' } }),
    submitPasswordReset: () => new Promise(resolve => { resolveReset = resolve; }), getErrorMessage: error => String(error),
    AppTrace: { trace() {}, warn() {}, error() {} }, toast: { success: (...args) => toasts.push(args), error: (...args) => toasts.push(args) } };
  cleanup = bind(resetCallbacks.effects[0], recoveryScope)();
  let submit = bind(resetCallbacks.submit, recoveryScope);
  let pending = submit({ value: { password: 'synthetic-test-only' } }); resolveReset({}); await pending;
  cleanup(); await flush(); assert.deepEqual(navigation, [], 'reset timer cannot redirect after leaving screen');
  reset(); cleanup = bind(resetCallbacks.effects[0], recoveryScope)();
  pending = submit({ value: { password: 'synthetic-test-only' } });
  auth.setState({ user: { id: 'bob' } }); auth.setState({ user: { id: 'alice' } });
  resolveReset({}); await pending; await flush();
  assert.deepEqual(navigation, []); assert.deepEqual(toasts, [], 'A-B-A ignores delayed reset completion'); cleanup();
  reset(); cleanup = bind(resetCallbacks.effects[0], recoveryScope)();
  pending = submit({ value: { password: 'synthetic-test-only' } }); cleanup(); resolveReset({}); await pending; await flush();
  assert.deepEqual(navigation, []); assert.deepEqual(toasts, [], 'unmounted reset response cannot issue feedback/navigation');
  reset(); cleanup = bind(resetCallbacks.effects[0], recoveryScope)();
  pending = submit({ value: { password: 'synthetic-test-only' } }); resolveReset({}); await pending; await flush();
  assert.deepEqual(navigation, ['/(auth)/login']); cleanup();
  console.log('PASS actual native recovery callback: normal success, unmount, delayed response, account-switch and success-timer cancellation');
})().catch(error => { console.error(error); process.exitCode = 1; });
