const { defineConfig } = require('eslint/config');

// Mirrors packages/core's minimal config. The fetch-ban that this package
// exists to enforce lives in packages/app's ESLint config (see
// docs/architecture/runtime-topology.md §2), NOT here — this package is the
// ONE place allowed to call the platform fetch primitive.
module.exports = defineConfig([
  {
    ignores: ['dist/*', 'node_modules/**', '*.config.js'],
  },
]);
