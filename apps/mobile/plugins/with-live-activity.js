/**
 * Expo Config Plugin: DVNT Live Activity (Android live-notification only).
 *
 * iOS Live Activities + home-screen widgets now run on the official, stable
 * `expo-widgets` library (SDK 56) — see the "expo-widgets" plugin entry in
 * app.config.js and `apps/mobile/widgets/*`. The previous hand-written WidgetKit
 * extension + custom ActivityKit Swift module (with-live-activity-ios.js,
 * live-activity-swift/*.swift) was removed; this orchestrator now only wires the
 * Android foreground "live notification" surface, a separate platform effort
 * untouched by the iOS migration. See docs/widgets-fit.md.
 */
const {
  withAndroidLiveNotification,
  withAndroidNotificationFiles,
} = require("./with-live-activity-android");

function withLiveActivity(config) {
  config = withAndroidLiveNotification(config);
  config = withAndroidNotificationFiles(config);
  return config;
}

module.exports = withLiveActivity;
