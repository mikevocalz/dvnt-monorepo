// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/**', '*.config.js'],
  },
  {
    // WS-6 boundary (§4 rule 2 of docs/structure-target.md): the promoted design
    // system must stay a LEAF — packages/ui may never import packages/app or any
    // app (apps/*). Enforced as `error` (in lockstep with the boundary ratchet in
    // packages/app/eslint.config.mjs, which is now `error` too).
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@dvnt/app', '@dvnt/app/**'],
              message:
                'packages/ui must never import packages/app — it is a leaf design system. Invert the dependency or promote the shared type. See docs/code-standards.md §Boundaries.',
            },
          ],
        },
      ],
    },
  },
]);