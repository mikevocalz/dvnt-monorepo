/** @type {import('expo/fingerprint').Config} */
module.exports = {
  // EAS computes the fingerprint AFTER `pod install` (build phase order:
  // INSTALL_PODS -> POST_INSTALL_HOOK -> CALCULATE_EXPO_UPDATES_RUNTIME_VERSION);
  // eas-cli computes it on this machine BEFORE any of that. CocoaPods writes
  // into these two package directories, so their dir hashes diverge by
  // construction and every build died on "Runtime version mismatch" in the
  // CONFIGURE_EXPO_UPDATES phase. Verified locally: `pod install` alone moved
  // the fingerprint 6827bae1 -> 6e340ceb with no other change.
  //
  // Dropping them loses no native-contract signal — the versions these pods
  // resolve to are captured in ios/Podfile.lock, which is still fingerprinted,
  // so the guarantee in app.config.js's runtimeVersion comment holds.
  // Paths are recorded relative to this directory and resolve OUTSIDE it in
  // this monorepo (`../../node_modules/...`), so a plain `**/node_modules/**`
  // glob does not match them — the relative form has to be spelled out.
  //
  // react-native-audio-api joined the list for a sharper version of the same
  // problem: its podspec has a `prepare_command` AND an every-build script
  // phase that DOWNLOAD binaries into the package itself —
  // `common/cpp/audioapi/external/**` gains four ffmpeg xcframeworks plus six
  // static archives. So `pod install` does not merely touch the directory, it
  // adds tens of megabytes of build products to it, and the two sides can never
  // agree. The EAS fingerprint diff named exactly this path:
  //   op "changed", filePath "../../node_modules/react-native-audio-api",
  //   reasons ["rncoreAutolinkingIos", "expoConfigPlugins"]
  ignorePaths: [
    '../../node_modules/@sentry/react-native',
    '../../node_modules/@sentry/react-native/**',
    '../../node_modules/@react-native-masked-view/masked-view',
    '../../node_modules/@react-native-masked-view/masked-view/**',
    '../../node_modules/react-native-audio-api',
    '../../node_modules/react-native-audio-api/**',
    // Workspace packages are FIRST-PARTY native modules, so their source is
    // real native contract and must stay fingerprinted — only their build
    // output is dropped. These paths are gitignored, so they exist on this
    // machine and never reach EAS (the project is uploaded via git), which is
    // the general form of the mismatch above: local hashes build artifacts EAS
    // has never seen. dvnt-translation carries android/build, android/.gradle
    // and a nested node_modules.
    '../../packages/*/android/build/**',
    '../../packages/*/android/.gradle/**',
    '../../packages/*/node_modules/**',
  ],
};
