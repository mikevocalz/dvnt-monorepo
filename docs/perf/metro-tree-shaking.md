# WS-A — Metro tree shaking: REVERTED, it produces an app that cannot boot

**Status 2026-08-15: tree shaking is off, the `react-native-css` patch is
deleted, and the EAS profiles are disarmed.** An earlier revision of this
document claimed −17.48% iOS / −17.01% Android. Those numbers were measured
against a bundle that crashes on launch. They were never real and are struck
from the record.

## What A5 found

The tree-shaken build installed on a physical iPad (iPad Pro 12.9, iOS 26.5.2)
and died immediately:

```
Unhandled JS Exception: [runtime not ready]:
ReferenceError: Property 'require' doesn't exist
  at global (main.jsbundle:1:171569)   jsEngine: hermes, __DEV__: false
App terminated due to signal 6.
```

This is **not** `expo/expo#41620`. It is caused by the local patch that was
applied to get past the build error, and it is the whole reason A5 is a gate:
the build was green, the bundle was smaller, and the app was 100% dead.

## Why the patch was wrong

`react-native-css@3.0.7`'s `getNativeInjectionCode()` synthesises a virtual
module as a raw ESM string. Under the optimize-graph serializer that module is
emitted at the **top level of the bundle, outside any `__d(...)` factory** —
which is precisely why its `import`/`export` statements survived to reach
`hermesc` and produced:

```
error: 'import' statement requires module mode
```

The patch rewrote that emission to `require(...)` + `module.exports`. That is
syntactically legal in script mode, so `hermesc` fell silent and the build went
green — but at top-level bundle scope Metro's `require` is not defined. The
patch converted a loud build-time failure into a silent runtime crash, which is
strictly worse: it ships.

The real fix has to put the injection module *inside* a module factory, or keep
it out of the optimized graph. Emitting different syntax at the same wrong scope
cannot work.

## Where this leaves it

- Flags removed from `preview`, `apk`, `production` in `eas.json` and from
  `apps/mobile/.env`.
- `apps/mobile/patches/react-native-css+3.0.7.patch` deleted.
- Upstream issue nativewind/react-native-css#414 stands; the CJS workaround
  suggested in it does NOT work and the issue has been updated to say so.
- The prize, if it is ever unblocked upstream, is worth measuring again from
  scratch. Do not trust the old numbers.

## A0 — the flag gates, cited to installed source

`@expo/cli@57.0.13`. Both default `false`.

| Seam | File + symbol |
|---|---|
| `EXPO_UNSTABLE_TREE_SHAKING` → `boolish(…, false)` | `build/src/utils/env.js:209-210` |
| `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH` → `boolish(…, false)` | `build/src/utils/env.js:212-213` |
| `CommandError` if shaking set without optimize-graph | `build/src/start/server/metro/instantiateMetro.js:270-271` |
| `optimize = props.optimize ?? (environment !== 'node' && mode === 'production' && env.EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH)` | `build/src/start/server/middleware/metroOptions.js:78` |
| `usedExports: optimize && env.EXPO_UNSTABLE_TREE_SHAKING` | `build/src/start/server/middleware/metroOptions.js:84` |
| `optimizeGraph:` / `treeshaking:` pass-through | `build/src/start/server/metro/instantiateMetro.js:307-308` |
| `experimentalImportSupport: true` default | `@expo/metro-config@57.0.7/build/ExpoMetroConfig.js:345` |

Both flags are production-mode gated and skipped for the `node` environment, so
dev workflows are untouched by design.

## A1 — baseline (still valid)

`EXPO_ATLAS=1 npx expo export --platform ios --platform android`, flags off:

| Platform | Hermes bytecode |
|---|---:|
| Android | 23,223,729 B |
| iOS | 23,074,008 B |

`--platform all` is not usable: web bundling fails on
`react-native-watch-connectivity`, whose `dist/index.js` requires `./RNWatch`
with no web fork.

## A5 — the gate did its job

Reaching this took clearing four separate blockers: no simulator destinations on
the scheme, a developer disk image that would not mount until the iPad was
cabled, four ad-hoc provisioning profiles that predated the iPad's registration,
and a preview build that could not reach the Sentry upload step without a token.

All of that was worth it. Every prior signal — local build green, EAS cloud
build green, `0` module-mode errors, a 17% smaller bundle — pointed the wrong
way. Only running the binary on hardware revealed the truth.
