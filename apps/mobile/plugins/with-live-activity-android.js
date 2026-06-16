/**
 * Android portion of the Live Activity config plugin.
 * Adds notification channel, RemoteViews layouts, BroadcastReceiver, native module.
 */

const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const ANDROID_NOTIFICATION_CHANNEL_ID = "dvnt_live_surface";

function withAndroidLiveNotification(config) {
  return withAndroidManifest(config, (config) => {
    const mainApp = config.modResults.manifest.application?.[0];
    if (!mainApp) return config;

    if (!mainApp.receiver) mainApp.receiver = [];
    const hasReceiver = mainApp.receiver.some((r) => r.$?.["android:name"] === ".LiveSurfaceReceiver");
    if (!hasReceiver) {
      mainApp.receiver.push({
        $: { "android:name": ".LiveSurfaceReceiver", "android:exported": "false" },
        "intent-filter": [{
          action: [
            { $: { "android:name": "com.dvnt.app.LIVE_SURFACE_PREV" } },
            { $: { "android:name": "com.dvnt.app.LIVE_SURFACE_NEXT" } },
            { $: { "android:name": "com.dvnt.app.LIVE_SURFACE_DISMISS" } },
          ],
        }],
      });
    }

    if (!mainApp["meta-data"]) mainApp["meta-data"] = [];
    const hasMeta = mainApp["meta-data"].some((m) => m.$?.["android:name"] === "com.dvnt.app.LIVE_SURFACE_CHANNEL_ID");
    if (!hasMeta) {
      mainApp["meta-data"].push({
        $: { "android:name": "com.dvnt.app.LIVE_SURFACE_CHANNEL_ID", "android:value": ANDROID_NOTIFICATION_CHANNEL_ID },
      });
    }

    return config;
  });
}

function withAndroidNotificationFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const androidDir = config.modRequest.platformProjectRoot;
      const layoutDir = path.join(androidDir, "app", "src", "main", "res", "layout");
      const javaDir = path.join(androidDir, "app", "src", "main", "java", "com", "dvnt", "app");
      const pluginDir = path.join(__dirname, "live-activity-android");

      fs.mkdirSync(layoutDir, { recursive: true });
      fs.mkdirSync(javaDir, { recursive: true });

      // Copy pre-written files from plugins/live-activity-android/
      const filesToCopy = [
        { src: "notification_live_surface.xml", dest: path.join(layoutDir, "notification_live_surface.xml") },
        { src: "notification_live_surface_expanded.xml", dest: path.join(layoutDir, "notification_live_surface_expanded.xml") },
        { src: "LiveSurfaceReceiver.kt", dest: path.join(javaDir, "LiveSurfaceReceiver.kt") },
        { src: "DVNTLiveNotificationModule.kt", dest: path.join(javaDir, "DVNTLiveNotificationModule.kt") },
        { src: "DVNTLiveNotificationPackage.kt", dest: path.join(javaDir, "DVNTLiveNotificationPackage.kt") },
      ];

      for (const f of filesToCopy) {
        const srcPath = path.join(pluginDir, f.src);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, f.dest);
        } else {
          console.warn(`[with-live-activity] Missing Android source: ${srcPath}`);
        }
      }

      console.log(`[with-live-activity] Wrote Android notification files`);
      return config;
    },
  ]);
}

module.exports = {
  withAndroidLiveNotification,
  withAndroidNotificationFiles,
};
