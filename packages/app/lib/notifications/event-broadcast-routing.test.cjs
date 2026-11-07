const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const policy = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/../../features/sneaky-lynk/cohost-invite-policy.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: policy });
const out = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(`${__dirname}/notificationRouter.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
  exports: out, console,
  require: name => name.includes('cohost-invite-policy') ? policy : name.includes('link-engine') ? { parseIncomingUrl: () => null } : { ticketActivityRoute: () => null },
});
test('native broadcast push resolves eventId and entityId without a canonical URL', () => {
  assert.equal(out.routeFromNotification({ type: 'event_broadcast', eventId: '90' }), '/(protected)/events/90');
  assert.equal(out.routeFromNotification({ type: 'event_broadcast', entityType: 'event', entityId: '90' }), '/(protected)/events/90');
  assert.equal(out.routeFromNotification({ type: 'event_broadcast' }), null);
});

test('co-host pushes open explicit invitation decisions, including legacy URLs', () => {
  for (const type of ['lynk_cohost_invited','lynk_cohost_accepted','lynk_cohost_declined']) {
    assert.equal(out.routeFromNotification({ type, roomId:'42', inviteId:'9', url:'https://dvntapp.live/sl/42' }), '/(protected)/(tabs)/activity');
  }
});
