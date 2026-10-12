const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const out = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/notificationRouter.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: out, console,
  require: name => name.includes('link-engine') ? { parseIncomingUrl: () => null } : { ticketActivityRoute: () => null },
});
test('native broadcast push resolves eventId and entityId without a canonical URL', () => {
  assert.equal(out.routeFromNotification({ type: 'event_broadcast', eventId: '90' }), '/(protected)/events/90');
  assert.equal(out.routeFromNotification({ type: 'event_broadcast', entityType: 'event', entityId: '90' }), '/(protected)/events/90');
  assert.equal(out.routeFromNotification({ type: 'event_broadcast' }), null);
});
