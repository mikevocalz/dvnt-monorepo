# WS-A — Metro tree shaking: measured, and blocked upstream

Measured 2026-08-14 on `master`. Verdict up front: **tree shaking is worth
−18.54% of the Android JS bundle and cannot be turned on today.** One synthetic
module emitted by `react-native-css@3.0.7` survives the optimize-graph
serializer as raw ESM, and `hermesc` refuses it. The flags stay off until this
is fixed upstream or worked around by the NativeWind maintainers.

## A1 — baseline (flags off)

`EXPO_ATLAS=1 npx expo export --platform ios --platform android`

| Platform | Hermes bytecode |
|---|---:|
| Android | 23,223,729 B |
| iOS | 23,074,008 B |

Atlas artifact: `.expo/atlas.jsonl`, 158,187,086 B. Preserved with the `dist/`
tree at `/tmp/dvnt-perf/before/` for the duration of this work — **not durable**;
re-run the export to regenerate.

`--platform all` is not usable here: web bundling fails on
`react-native-watch-connectivity`, whose `dist/index.js` requires `./RNWatch`
with no web fork. WS-A is native-only, so this baseline is iOS + Android.

## A2 — the size prize, and the wall

Bytecode cannot be generated with the flags on, so the two sides are compared as
plain JS (`--no-bytecode`), which is a like-for-like measurement:

| Android bundle | Bytes |
|---|---:|
| Baseline (flags off) | 15,968,353 |
| Tree-shaken | 13,007,862 |
| **Delta** | **−2,960,491 B (−18.54%)** |

Module count is 7,828 either way — the win is intra-module dead-export
elimination, not dropped modules, which is exactly what `usedExports` does.

With bytecode generation on (the default, and what ships), the export fails:

```
Failed to generate Hermes bytecode for: node_modules/expo-router/entry.js
index.js:844745:1: error: 'import' statement requires module mode
index.js:853525:1: error: 'export' statement requires module mode
hermesc ... exited with non-zero code: 2
```

Reproduced by running `hermesc` directly against the `--no-bytecode` output, which
pins it to one line and two columns:

```
entry-acec3dd516ad758ab08b92b6f07e0d7a.js
5663:14:     error: 'import' statement requires module mode
5663:128908: error: 'export' statement requires module mode
```

That line reads:

```js
"use strict";import{StyleCollection}from"react-native-css/native-internal";
StyleCollection.inject({s:[["pointer-events-auto",…]]});
…
},5259,[244]);export{};
```

### Root cause

`react-native-css@3.0.7` →
`dist/commonjs/metro/injection-code.js` → `getNativeInjectionCode()`:

```js
return Buffer.from(
  `import { StyleCollection } from "react-native-css/native-internal";\n` +
  `${importStatements}\n${contents};export {};`
);
```

It synthesises a virtual module as a raw ESM **string**. Its own header comment
calls it "a hack around Metro's handling of bundles" — it force-imports the CSS
files into every bundle so Tailwind survives `lazy()` barriers.

Under the normal pipeline that synthetic source is transformed to CJS like any
other module. Under `EXPO_UNSTABLE_METRO_OPTIMIZE_GRAPH` +
`EXPO_UNSTABLE_TREE_SHAKING` the serializer re-emits modules from their ESM
form, and this one reaches the concatenated bundle with `import` and `export`
intact. `hermesc` compiles the bundle in script mode, not module mode, so both
statements are hard errors.

Installed: `nativewind@5.0.0-preview.4`, `react-native-css@3.0.7`.

### Ruled out

| Hypothesis | Test | Result |
|---|---|---|
| Expo Atlas instrumentation perturbs the serializer | Re-ran with flags + bytecode, `EXPO_ATLAS` unset | Same failure — not Atlas |
| Only the two-platform export is affected | Android alone | Same failure |
| The bundle is fine and the bytecode step is at fault | Ran `hermesc` by hand on the `--no-bytecode` bundle | Same two errors — the bundle genuinely contains ESM |

This is **not** `expo/expo#41620` (the Worklets `Native part of Worklets doesn't
seem to be initialized` release crash). We never reach a running app: the build
fails at bytecode generation. #41620 remains an open risk for whenever the flags
do get enabled, and A5 device QA is still owed at that point.

## Status of the remaining WS-A steps

- **A2 (enable)** — deliberately NOT done. Neither flag is set in `.env` or any
  `eas.json` profile. Setting them today breaks every production build.
- **A3 (`sideEffects` audit)**, **A4 (barrel audit)** — not started. Both are
  optimisations *on top of* a working shaking pass; auditing side effects while
  the pass cannot produce a bundle would be unverifiable.
- **A5 (release device QA)** — cannot run. `adb devices` is empty, `xcrun
  xctrace list devices` shows only the host Mac, and `xcrun devicectl list
  devices` reports both iPhones `unavailable`. No physical device is reachable.

`expo-atlas@^0.4.0` was added to `apps/mobile` devDependencies — `EXPO_ATLAS=1`
installs it on first use and A1/A6 both require it.

## What would unblock this

In rough order of cost:

1. **Upstream fix in `react-native-css`** — emit the injection module as CJS, or
   register it through a transformer so the optimize-graph serializer converts
   it. This is their hack to own; the file already admits it is one.
2. **Upstream fix in `@expo/cli`** — have the graph-optimize pass run virtual /
   synthetic modules through the ESM→CJS transform before concatenation.
3. **Local shim** — intercept the module in `metro.config.js` and hand back a
   CJS equivalent. Fastest, and it forks a documented upstream hack inside our
   build; it would need re-verifying on every `react-native-css` bump.

Recommendation: file upstream against `react-native-css` with the reproduction
above, and hold the flags off. −18.54% is a real prize but not worth carrying a
fork of someone else's hack through every dependency bump.
