module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // No jsxImportSource: that was the NativeWind v4 setup and v5 ships no
      // jsx-runtime at all, so every transformed file (including Expo's own
      // sources under node_modules) asked Metro for a module that does not
      // exist. v5 styles via its Metro transformer + react-native-css instead.
      ["babel-preset-expo", { unstable_transformImportMeta: true }],
    ],
    plugins: [
      // Strip console.log/info/debug from release bundles.
      //
      // Not a size optimisation. On iOS every console call goes out through
      // NSLog, which takes a process-wide unfair lock inside CoreFoundation's
      // stderr writer. The 2026-09-07 20:47 watchdog kill (0x8BADF00D,
      // "scene-update ... exhausted real (wall clock) time allowance of 10.00
      // seconds") had the main thread parked in exactly that lock —
      // __ulock_wait2 <- _os_unfair_lock_lock_slow <- _logToStderr — inside
      // EXTaskService's own NSLog, before any of our JS ran. 972 console.log
      // calls shipped in this bundle, 385 of them in stores, components and
      // features, so the contention was ours to reduce even though the frame
      // that blocked is Expo's.
      //
      // This deletes the call sites outright, which the previous JS-side
      // no-op could not: it left the calls and their argument evaluation in
      // place. That shim existed only because this plugin changes the React
      // Native autolinking config and so moves the EAS fingerprint — fine now
      // that we are cutting a new build, and the shim is gone with it.
      //
      // warn and error are kept: Sentry lifts them as breadcrumbs, and they
      // are rare enough not to be the pressure.
      ...(process.env.NODE_ENV === "production"
        ? [["transform-remove-console", { exclude: ["error", "warn"] }]]
        : []),
      "react-native-worklets/plugin",
    ],
  };
};
