// WS-6 boundary / no-cycle lint for @dvnt/app.
//
// These rules encode the §4 boundary contract from docs/structure-target.md and
// the "Boundaries" section of docs/code-standards.md. They are intentionally
// LANDED AS `warn`, NOT `error`: the deferred deep-import cleanup and the
// packages/ui component-consolidation sweep (§5) are not done yet, so making
// these errors today would break `turbo lint` / CI on the pre-existing
// violations the migration still has to work through.
//
// >>> FLIP TO `error` AFTER THE CONSOLIDATION SWEEP <<<
// Once features expose a single barrel and consumers stop deep-importing feature
// internals (and cycles are cleared), change the two `"warn"` severities below to
// `"error"` so the boundary becomes CI-enforced. Track the violation count with
// `pnpm --filter @dvnt/app lint` — it should reach zero before the flip.
//
// Tooling note: implemented with eslint-plugin-import (already a devDependency)
// + core no-restricted-imports, resolving the `@dvnt/app/*` alias via
// eslint-import-resolver-typescript. dependency-cruiser was intentionally NOT
// added — it is not installed and eslint-plugin-import covers cycle detection
// without a new heavyweight dependency.

import path from "node:path";
import { fileURLToPath } from "node:url";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The app source carries hundreds of inline `eslint-disable` directives naming
// plugin rules (@typescript-eslint/*, @next/next/*, react-hooks/*, jsx-a11y/*,
// react-compiler/*, @eslint-react/*, @definitelytyped/*) that belong to the
// Next.js / Expo app configs, NOT to this focused boundary config. Left
// unregistered, ESLint reports each as a hard error ("Definition for rule ... was
// not found") and the build fails. We register a no-op shim so every such rule id
// RESOLVES (defined, but off) — the real Next/Expo configs still enforce them in
// their own trees; here we only care about the two boundary rules below.
const noopRule = { create: () => ({}) };
const shim = {
  rules: new Proxy(
    {},
    {
      get: () => noopRule,
      has: () => true,
    },
  ),
};

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "build/**",
      ".turbo/**",
      ".expo/**",
      "android/**",
      "ios/**",
      "modules/**/android/**",
      "modules/**/ios/**",
      "assets/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    // Pre-existing inline disable directives target the app's Next/Expo configs,
    // not this boundary pass — don't flag them as unused here.
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      import: importPlugin,
      "@typescript-eslint": shim,
      "@next/next": shim,
      "react-hooks": shim,
      "jsx-a11y": shim,
      "react-compiler": shim,
      "@eslint-react": shim,
      "@definitelytyped": shim,
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: path.join(__dirname, "tsconfig.json"),
        },
      },
    },
    rules: {
      // (a) Cycle ban. Circular imports are the direct symptom of the
      // cross-root tangle WS-6 is unwinding. `ignoreExternal` keeps the graph
      // walk inside the workspace (fast; node_modules cycles are not our bug).
      "import/no-cycle": ["warn", { ignoreExternal: true }],

      // (c) Features are consumed only via their public barrel
      // (`@dvnt/app/features/<x>`). Deep-importing another feature's internals
      // through the alias is forbidden; intra-feature relative imports (`./`,
      // `../`) and app-global namespaces (`@dvnt/app/lib/*`, `@dvnt/ui`) stay
      // legal and are not matched here.
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              group: [
                "@dvnt/app/features/*/api/**",
                "@dvnt/app/features/*/hooks/**",
                "@dvnt/app/features/*/stores/**",
                "@dvnt/app/features/*/ui/**",
                "@dvnt/app/features/*/components/**",
                "@dvnt/app/features/*/screens/**",
                "@dvnt/app/features/*/types/**",
              ],
              message:
                "Import features through their public barrel (@dvnt/app/features/<feature>), not a deep path into another feature's internals. See docs/code-standards.md §Boundaries.",
            },
          ],
        },
      ],
    },
  },
];
