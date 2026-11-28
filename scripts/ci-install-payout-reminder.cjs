// Retry only the observed pnpm hoisted-import rename race, once in the same workspace.
// Never hide lockfile, integrity, network, or test failures.
const { spawnSync } = require('node:child_process');
function install(run = spawnSync) {
  const args = ['install', '--frozen-lockfile', '--ignore-scripts'];
  const attempt = (extra = []) => {
    const result = run('pnpm', [...args, ...extra], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    return result;
  };
  let result = attempt();
  const output = (result.stdout || '') + (result.stderr || '');
  if (result.status !== 0 && !result.error && /ERR_PNPM_ENOENT/.test(output)
      && /rename[^\n]*node_modules[^\n]*_tmp_/.test(output)) {
    process.stderr.write('Retrying the recognized hoisted-import rename failure once.\n');
    result = attempt(['--force']);
  }
  return result.status ?? 1;
}
if (require.main === module) process.exitCode = install();
module.exports = { install };
