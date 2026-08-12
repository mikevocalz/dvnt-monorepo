// WS-6 boundary / no-cycle lint for @dvnt/app.
//
// These rules encode the §4 boundary contract from docs/structure-target.md and
// the "Boundaries" section of docs/code-standards.md. They are now `error`:
// the deep-import cleanup is complete — every cross-feature consumer routes
// through a feature's public barrel and no cycles remain — so the boundary is
// CI-enforced. Track the violation count with `pnpm --filter @dvnt/app lint`;
// it must stay at zero.
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
import noBarrelFiles from "eslint-plugin-no-barrel-files";

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
      "import/no-cycle": ["error", { ignoreExternal: true }],

      // (c) Features are consumed only via their public barrel
      // (`@dvnt/app/features/<x>`). Deep-importing another feature's internals
      // through the alias is forbidden; intra-feature relative imports (`./`,
      // `../`) and app-global namespaces (`@dvnt/app/lib/*`, `@dvnt/ui`) stay
      // legal and are not matched here.
      // OWNERSHIP, not route-through-barrel. See docs/barrels-decision.md.
      //
      // The intent of this rule was always "do not reach into another feature's
      // internals". Requiring a barrel was the MECHANISM, and that mechanism
      // carries a runtime cost the intent never asked for: Expo 57's tree
      // shaking is off in this repo (it needs EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH
      // + EXPO_UNSTABLE_TREE_SHAKING, neither of which is set), so Metro bundles
      // and evaluates EVERY module behind a barrel before the one you asked for
      // returns — straight onto TTI.
      //
      // So the ban stays on OTHER features' internals, and the per-feature
      // overrides below re-permit a feature's own deep paths. A feature owns its
      // own tree; nobody else reaches into it.
      "no-restricted-imports": [
        "error",
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
                "Don't reach into another feature's internals — import its public surface (@dvnt/app/features/<feature>) or, on a hot path, the specific module you need from your OWN feature. See docs/barrels-decision.md.",
            },
          ],
        },
      ],
    },
  },

  // ── WS-1: Calls and Sneaky Lynk are separate stacks (Phase-0 decision) ────
  // The generic rule above still permits importing another feature's PUBLIC
  // barrel; that's too loose here — call and Lynk share no code by design
  // (room_kind splits them at the data layer too), so block the barrel import
  // itself, not just deep internals.
  {
    files: ["features/sneaky-lynk/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dvnt/app/features/call", "@dvnt/app/features/call/**", "@dvnt/app/features/calls", "@dvnt/app/features/calls/**"],
              message: "Sneaky Lynk and the call stack are separate (WS-1) — no cross-imports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["features/call/**/*.{ts,tsx}", "features/calls/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@dvnt/app/features/sneaky-lynk", "@dvnt/app/features/sneaky-lynk/**"],
              message: "The call stack and Sneaky Lynk are separate (WS-1) — no cross-imports.",
            },
          ],
        },
      ],
    },
  },

  // ── Hot paths: no NEW barrel files (docs/barrels-decision.md, option c) ────
  // Tree shaking is off in this repo (verified against installed Expo source —
  // it needs EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH + EXPO_UNSTABLE_TREE_SHAKING,
  // neither set), so every module behind a barrel is bundled AND evaluated
  // before the one you asked for returns. On the surfaces that decide first
  // paint, that lands straight on TTI.
  //
  // `warn`, not `error`, on purpose: 7 barrels already exist on these paths
  // (events 2, video 2, ticket 3). Failing on them today would break the
  // "app lint exit 0" gate and force a rewrite of every importer before WS-7
  // has measured whether it's worth it. Those 7 ARE the measurement targets —
  // WS-7 confirms or refutes the saving, and this flips to error or comes out.
  {
    files: [
      "components/feed/**/*.{ts,tsx}",
      "features/events/**/*.{ts,tsx}",
      "features/video/**/*.{ts,tsx}",
      "features/call/**/*.{ts,tsx}",
      "features/ticket/**/*.{ts,tsx}",
    ],
    plugins: { "no-barrel-files": noBarrelFiles },
    rules: {
      "no-barrel-files/no-barrel-files": "warn",
    },
  },
];
