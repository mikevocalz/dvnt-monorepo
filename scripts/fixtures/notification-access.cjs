// Execute the actual private-access helper against synthetic identity/JWT edges.
// Authentication boundaries are fixtures; no live account or token is used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
module.exports = function notificationAccessFixture(getUserId, getEpoch = () => 0) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../../packages/app/lib/api/notification-access.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, { exports, require(name) {
    if (name.includes('auth/identity')) return {
      getCurrentUserIdSync: getUserId,
      getCurrentUserRow: async () => ({ id: getUserId(), authId: `fixture-${getUserId()}` }),
    };
    if (name.includes('supabase-jwt')) return { ensureSupabaseJwt: async subject => subject === `fixture-${getUserId()}` };
    if (name.includes('session-lifecycle')) return { getSessionLifecycle: () => ({ epoch: getEpoch() }) };
    if (name.includes('supabase/client')) return { getBridgeRequestEpoch: () => String(getEpoch()) };
    throw new Error(`Unexpected access dependency: ${name}`);
  } });
  return exports;
};
