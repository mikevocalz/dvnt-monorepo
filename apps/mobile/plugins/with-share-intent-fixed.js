const { createRunOncePlugin, withPlugins } = require("expo/config-plugins");
const {
  withAndroidIntentFilters,
} = require("expo-share-intent/plugin/build/android/withAndroidIntentFilters");
const {
  withAndroidMainActivityAttributes,
} = require("expo-share-intent/plugin/build/android/withAndroidMainActivityAttributes");
const {
  withAppEntitlements,
} = require("expo-share-intent/plugin/build/ios/withIosAppEntitlements");
const {
  withIosAppInfoPlist,
} = require("expo-share-intent/plugin/build/ios/withIosAppInfoPlist");
const {
  withShareExtensionConfig,
} = require("expo-share-intent/plugin/build/ios/withIosShareExtensionConfig");
const {
  withShareExtensionXcodeTarget,
} = require("expo-share-intent/plugin/build/ios/withIosShareExtensionXcodeTarget");
const {
  withCompatibilityChecker,
} = require("expo-share-intent/plugin/build/withCompatibilityChecker");
const expoShareIntentPkg = require("expo-share-intent/package.json");
const withShareExtensionVersionSync = require("./with-share-extension-version-sync");

function withShareIntentFixed(config, props = {}) {
  return withPlugins(config, [
    ...(!props.disableIOS
      ? [
          (config) => withIosAppInfoPlist(config, props),
          (config) => withAppEntitlements(config, props),
          (config) => withShareExtensionConfig(config, props),
          withShareExtensionVersionSync,
          (config) => withShareExtensionXcodeTarget(config, props),
        ]
      : []),
    ...(!props.disableAndroid
      ? [
          (config) => withAndroidIntentFilters(config, props),
          (config) => withAndroidMainActivityAttributes(config, props),
        ]
      : []),
    (config) => withCompatibilityChecker(config, props),
  ]);
}

module.exports = createRunOncePlugin(
  withShareIntentFixed,
  "with-share-intent-fixed",
  expoShareIntentPkg.version,
);
