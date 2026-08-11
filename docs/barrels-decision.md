# Barrels vs. TTI — decision

**Date:** 2026-08-11 · **Decides:** modernization prompt §4.5 · **Gates:** WS-7
**Outcome: (c) — the cost is real.** Barrels stop being mandatory on hot paths;
the boundary rule is reshaped to enforce **ownership**, not route-through-barrel.

---

## 1. The question that decided it

WS-6 deliberately routed 118 imports through 9+3 feature barrels and flipped the
lint to `error`. The optimization guide's *Avoid Barrel Exports* chapter is the
counterweight: Metro bundles **every** module reachable through a barrel even
when one symbol is imported, and **all** of them evaluate before the requested
module returns — a direct TTI cost.

Both positions are defensible only if you don't know whether Expo's tree shaking
is absorbing it. So that was the question to answer first, and it is answerable
from installed source rather than opinion.

## 2. Tree shaking is OFF in this repo — verified, not assumed

Expo `57.0.1`, `@expo/metro-config` `57.0.7`.

The tree-shake serializer **is** unconditionally in the pipeline —
`@expo/metro-config/build/serializer/withExpoSerializers.js:48`:

```js
// Then tree-shake the modules.
processors.push(getTreeShakeSerializer());
```

…which is exactly why "it's in there" proves nothing. The plugin no-ops on entry
unless a serializer option is set —
`serializer/treeShakeSerializerPlugin.js:129`:

```js
async function treeShakeSerializer(entryPoint, preModules, graph, options) {
  if (!options.serializerOptions?.usedExports) {
    return [entryPoint, preModules, graph, options];   // graph returned untouched
  }
```

And that option requires **two** env flags —
`@expo/cli/build/src/start/server/middleware/metroOptions.js:78-84`:

```js
const optimize = props.optimize ?? (environment !== 'node'
  && mode === 'production'
  && env.EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH);
usedExports: optimize && env.EXPO_UNSTABLE_TREE_SHAKING,
```

**Neither `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH` nor `EXPO_UNSTABLE_TREE_SHAKING`
is set anywhere** in `apps/`, `packages/`, `metro.config.js`, `app.config.js`, or
`eas.json`. `metro.config.js` sets `unstable_enablePackageExports = true`, which
is package-exports resolution — a different thing — and `app.config.js`'s
`experiments` block holds only `typedRoutes` / `reactCanary` / `reactCompiler`.

Both flags are also `UNSTABLE_` and gated to `mode === 'production'`, so dev
bundles could never shake even if they were set.

**Therefore option (a) — "tree shaking absorbs it, keep the barrels" — is
factually unavailable.** The barrel cost in this repo is unmitigated.

## 3. Why (c) and not (b)

(b) would keep barrels mandatory everywhere and carve lint exceptions on hot
paths. That leaves the rule saying one thing and the codebase doing another, and
every exception becomes a judgement call at review time.

(c) fixes the rule instead. The boundary rule's **intent was never "use a
barrel"** — it was *"do not reach into another feature's internals."* Routing
through a barrel was the mechanism, and the mechanism turned out to carry a
runtime cost the intent never asked for. So: enforce the intent directly.

- A feature may import its own internals by any path, deep or not.
- A feature may **not** import another feature's internals — unchanged.
- Cross-feature imports go through the public surface, but that surface no
  longer has to be a single re-exporting barrel module.
- On hot paths, prefer direct module imports over barrels.

## 4. Hot paths

Where the barrel-evaluation cost lands on first paint, per the prompt:

- feed
- event pages
- checkout
- video grid
- calls UI

## 5. What is NOT being done, and why

**The flags are not being flipped.** Turning on graph optimization plus tree
shaking, in production only, on a 22 MB bundle carrying Reanimated worklets,
Skia, VisionCamera and a React Compiler build, is the archetypal change that
produces a green build and a broken runtime. Both flags are explicitly
`UNSTABLE_`. If it is wanted, it is its own isolated experiment with a device
smoke test — not a line added during WS-7.

## 6. Still owed (WS-7 input)

This decision is grounded in source, not in measurement. WS-7 still owes the
numbers the prompt asks for, and they should confirm or refute the predicted
saving in the same table:

- JS bundle size, barrels-routed vs. direct, both platforms
- Cold-start **TTI**, same comparison
- Per the guide's *Analyze JS Bundle Size* and *How to Measure TTI* procedures

If the measured delta turns out to be negligible, the ownership reshape still
stands on its own merits — it is a more honest statement of the boundary — but
the hot-path guidance can be relaxed.
