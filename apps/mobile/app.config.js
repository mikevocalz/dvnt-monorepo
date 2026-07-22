// Use 'single' output for pure SPA - no SSR/SSG means no Node.js execution of native modules
// Native modules (expo-secure-store, react-native-vision-camera, etc.) can't run in Node.js
// Use the standalone server/ directory for production API deployment
const webOutput = "single";

// Stability: gate experimental flags for production (EAS production profile sets APP_ENV=production)
const appEnv =
  process.env.APP_ENV ?? process.env.EXPO_PUBLIC_APP_ENV ?? "development";
const isProd = appEnv === "production";

// Dynamic origin - uses Supabase URL with production fallback
const routerOrigin =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  "https://npfjanxturvmjyevoyfo.supabase.co";

const fishjamAppIdFallback = "28026441819941d78c40584fb830f851";

// Conservative native hardening rollout:
// - enable recent-app screenshot protection on iOS/Android
// - intentionally leave SSL pinning unset until real production pin material exists
// - keep iOS cache disabling off because it can impact offline/cached behavior
const appSecurityPlugin = [
  "@bam.tech/react-native-app-security",
  {
    preventRecentScreenshots: {
      ios: { enabled: true },
      android: { enabled: true },
    },
  },
];

export default {
  expo: {
    name: "DVNT",
    slug: "dvnt",
    version: "1.0.0",
    runtimeVersion: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    userInterfaceStyle: "automatic",
    splash: {
      image: "./assets/images/splash-icon.png",
      resizeMode: "contain",
      backgroundColor: "#000000",
    },
    assetBundlePatterns: ["**/*"],
    updates: {
      url: "https://u.expo.dev/5c0d13a3-c544-4ffc-ae8f-8e897dda2663",
      fallbackToCacheTimeout: 0, // Launch immediately with cached bundle — JS hook handles update check
      checkAutomatically: "ON_LOAD", // Changed from ON_ERROR_RECOVERY: applies cached OTA on cold start without needing reloadAsync() (which crashes iOS 26 Fabric)
      enableBsdiffPatchSupport: true,
      waitBeforeLaunchMs: 0, // Do not block launch waiting for OTA — avoids ErrorRecovery crash loop
      // Enhanced crash hardening
      // CRITICAL: Use appEnv (which reads APP_ENV from EAS profiles), NOT NODE_ENV
      // NODE_ENV defaults to "development" during Metro bundling even for production builds
      enabled: appEnv === "production" || appEnv === "preview", // Enable OTA for production and preview builds only
      runtimeVersion: "1.0.0", // Fixed runtime version for OTA safety
      message: "A new version is available. Restart to apply updates.", // User-friendly message
    },
    buildCacheProvider: "eas",
    ios: {
      supportsTablet: true,
      usesAppleSignIn: true,
      bundleIdentifier: "com.dvnt.app",
      // Required so @bacons/apple-targets can codesign the watch + complication
      // targets (mirrors the with-development-team plugin's teamId).
      appleTeamId: "436WA3W63V",
      icon: "./assets/images/ios-icon.png",
      associatedDomains: ["applinks:dvntapp.live", "applinks:www.dvntapp.live"],
      deploymentTarget: "17.0",
      // App Group for the iPhone-side ExtensionStorage write (watch reads its own
      // group over WCSession — App Group containers are per-device).
      entitlements: {
        "com.apple.security.application-groups": ["group.com.dvnt.app"],
      },
      privacyManifests: {
        NSPrivacyCollectedDataTypes: [
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeAudioData",
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeVideoData",
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
          {
            NSPrivacyCollectedDataType:
              "NSPrivacyCollectedDataTypePreciseLocation",
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
          {
            NSPrivacyCollectedDataType:
              "NSPrivacyCollectedDataTypePurchaseHistory",
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypePaymentInfo",
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeUserID",
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
              "NSPrivacyCollectedDataTypePurposeProductPersonalization",
            ],
          },
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeDeviceID",
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
              "NSPrivacyCollectedDataTypePurposeAnalytics",
            ],
          },
          {
            NSPrivacyCollectedDataType:
              "NSPrivacyCollectedDataTypePhotosorVideos",
            NSPrivacyCollectedDataTypeLinked: true,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
          {
            NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeContacts",
            NSPrivacyCollectedDataTypeLinked: false,
            NSPrivacyCollectedDataTypeTracking: false,
            NSPrivacyCollectedDataTypePurposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
        ],
        NSPrivacyAccessedAPITypes: [
          {
            NSPrivacyAccessedAPIType:
              "NSPrivacyAccessedAPICategoryFileTimestamp",
            NSPrivacyAccessedAPITypeReasons: ["C617.1"],
          },
          {
            NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryDiskSpace",
            NSPrivacyAccessedAPITypeReasons: ["7D9E.1"],
          },
          {
            NSPrivacyAccessedAPIType:
              "NSPrivacyAccessedAPICategoryUserDefaults",
            NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
          },
        ],
        NSPrivacyTrackingDomains: [],
        NSPrivacyTracking: false,
      },
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "DVNT uses your camera to capture photos and videos for posts, stories, and live video rooms. Your camera is only active while you are creating content.",
        NSPhotoLibraryUsageDescription:
          "DVNT accesses your photo library so you can choose photos and videos to share in posts and stories.",
        NSMicrophoneUsageDescription:
          "DVNT uses your microphone to record audio for video posts, stories, and live video rooms. Your microphone is only active while you are recording or in a live room.",
        UIBackgroundModes: ["audio", "voip"],
        NSPhotoLibraryAddUsageDescription:
          "DVNT saves media to your photo library when you choose to download photos or videos.",
        NSLocationWhenInUseUsageDescription:
          "DVNT uses your location to show nearby events and suggest relevant venues while you are using the app. Your location is never stored or shared without your permission.",
        // FaceID / TouchID is offered as an optional second factor on
        // sensitive actions (account deletion, payment confirmation).
        // iOS crashes any process that calls LocalAuthentication on a
        // FaceID-capable device without this string in Info.plist.
        NSFaceIDUsageDescription:
          "DVNT uses Face ID or Touch ID to confirm your identity before sensitive actions like deleting your account or confirming a payment.",
        // iOS 17 split calendar permissions into a write-only key and a
        // full-access key. DVNT calls Calendar.getCalendarsAsync (read)
        // and Calendar.createEventAsync (write) when a user adds an
        // event to their calendar, so we need full access.
        NSCalendarsFullAccessUsageDescription:
          "DVNT adds event reminders to your calendar when you choose to save an event, and reads your existing calendars so you can pick which one to save into.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/adaptive-icon.png",
        backgroundColor: "#000000",
      },
      package: "com.dvnt.app",
      intentFilters: [
        {
          action: "VIEW",
          autoVerify: true,
          data: [
            { scheme: "https", host: "dvntapp.live", pathPrefix: "/" },
            { scheme: "https", host: "www.dvntapp.live", pathPrefix: "/" },
          ],
          category: ["BROWSABLE", "DEFAULT"],
        },
      ],
      permissions: [
        // ── Media ──
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_MEDIA_IMAGES",
        "android.permission.READ_MEDIA_VIDEO",
        "android.permission.READ_MEDIA_AUDIO",
        "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
        "android.permission.ACCESS_MEDIA_LOCATION",
        // ── Location ──
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        // ── Notifications ──
        "android.permission.VIBRATE",
        "android.permission.POST_NOTIFICATIONS",
        // ── CallKeep / Telecom (ConnectionService) ──
        // READ_PHONE_STATE: required by CallKeep on Android < 30
        "android.permission.READ_PHONE_STATE",
        // READ_PHONE_NUMBERS: required by CallKeep on Android 30+ (API 30 = Android 11)
        // VoiceConnectionService.createConnection() calls telecomManager.getPhoneAccount()
        // which throws SecurityException without this permission.
        "android.permission.READ_PHONE_NUMBERS",
        // CALL_PHONE: required by CallKeep for outgoing call registration
        "android.permission.CALL_PHONE",
        // MANAGE_OWN_CALLS: required for self-managed ConnectionService
        "android.permission.MANAGE_OWN_CALLS",
        // BIND_TELECOM_CONNECTION_SERVICE: required for VoiceConnectionService
        "android.permission.BIND_TELECOM_CONNECTION_SERVICE",
        // Foreground service permissions for in-call notification
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
        "android.permission.FOREGROUND_SERVICE_CAMERA",
        "android.permission.FOREGROUND_SERVICE_MICROPHONE",
        // USE_FULL_SCREEN_INTENT: required for incoming call full-screen UI on Android 10+
        "android.permission.USE_FULL_SCREEN_INTENT",
      ],
      config: {
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
        },
      },
    },
    web: {
      favicon: "./assets/images/favicon.png",
      bundler: "metro",
      output: webOutput,
    },
    plugins: [
      // Sentry (dvnt-mobile): native symbol upload + source maps on EAS builds.
      // Needs SENTRY_AUTH_TOKEN in EAS secrets for the upload step; builds
      // succeed without it (stacks stay unsymbolicated until it's added).
      [
        "@sentry/react-native/expo",
        { organization: "5th-galaxy-studios", project: "dvnt-mobile" },
      ],
      // Links native targets (Apple Watch app + watch complication) outside /ios
      // via CNG. Auto-discovers apps/mobile/targets/*/expo-target.config.js.
      // TEMPORARILY DISABLED for the SDK 56 production build: the watch
      // complication App ID (com.dvnt.app.watchkitapp.complication) isn't
      // registerable on the Individual Apple team, which blocked credential
      // setup. The watch app was held-back anyway (PROMPT 7). Re-enable once the
      // watch App IDs are registered on the Apple Developer portal.
      // "@bacons/apple-targets",
      "./plugins/disable-user-script-sandboxing",
      "./plugins/with-app-controller-init",
      // Install NSSetUncaughtExceptionHandler EARLY so it's the first
      // thing in didFinishLaunchingWithOptions — captures any
      // uncaught NSException from any thread (TurboModule dispatch
      // workers, AVAudioSession callbacks, Stripe sheets, etc.) with
      // name / reason / call-stack-symbols persisted for next launch.
      "./plugins/with-uncaught-exception-handler",
      "./plugins/android-fixes",
      "./plugins/fix-wgpu-headers",
      "./plugins/with-cube-luts",
      "./plugins/disable-frame-processors",
      "./plugins/fix-visioncamera-barcode-scanner-swift",
      "expo-asset",
      "expo-audio",
      "expo-font",
      "expo-image",
      "expo-localization",
      "expo-share-intent",
      "expo-sharing",
      "expo-splash-screen",
      "expo-status-bar",
      "expo-web-browser",
      "@config-plugins/react-native-webrtc",
      "expo-apple-authentication",
      [
        "@stripe/stripe-react-native",
        {
          merchantIdentifier: "merchant.com.dvnt.app",
          enableGooglePay: true,
        },
      ],
      "./plugins/with-stripe-merchant-entitlement",
      [
        "expo-router",
        {
          origin: routerOrigin,
        },
      ],
      appSecurityPlugin,
      "./plugins/with-swift5-compat",
      [
        "expo-build-properties",
        {
          ios: {
            deploymentTarget: "17.0",
          },
          // Disable experimental RN/Hermes flags in production to reduce SIGTRAP crash risk
          buildReactNativeFromSource: !isProd,
          // useHermesV1: !isProd, // Disabled due to version conflicts
        },
      ],
      [
        "expo-video",
        {
          supportsBackgroundPlayback: false,
          supportsPictureInPicture: false,
        },
      ],
      "react-native-video",
      [
        "expo-image-picker",
        {
          photosPermission:
            "DVNT accesses your photo library so you can choose photos and videos to share in posts and stories.",
          cameraPermission:
            "DVNT uses your camera to capture photos and videos for posts, stories, and live video rooms.",
          microphonePermission:
            "DVNT uses your microphone to record audio for video posts, stories, and live video rooms.",
        },
      ],
      [
        "expo-media-library",
        {
          photosPermission:
            "DVNT accesses your photo library so you can choose media to share in posts and stories.",
          savePhotosPermission:
            "DVNT saves media to your photo library when you choose to download photos or videos.",
          isAccessMediaLocationEnabled: true,
        },
      ],
      [
        "expo-screen-orientation",
        {
          initialOrientation: "PORTRAIT_UP",
        },
      ],
      [
        "expo-camera",
        {
          cameraPermission:
            "DVNT uses your camera to capture photos and videos for posts, stories, and live video rooms.",
          microphonePermission:
            "DVNT uses your microphone to record audio for video posts, stories, and live video rooms.",
          recordAudioAndroid: true,
        },
      ],
      [
        "expo-maps",
        {
          android: {
            googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
          },
          ios: {
            googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
          },
          requestLocationPermission: true,
          locationPermission:
            "DVNT uses your location to show nearby events and suggest relevant venues while you are using the app.",
        },
      ],
      "@config-plugins/react-native-callkeep",
      "./plugins/with-voip-push",
      "./plugins/with-custom-ringtone",
      "./plugins/with-live-activity",
      ["./plugins/with-development-team", { teamId: "436WA3W63V" }],
      "expo-secure-store",
      "react-native-compressor",
      [
        "expo-calendar",
        {
          calendarPermission:
            "DVNT adds event reminders to your calendar when you choose to save events.",
        },
      ],
      [
        "expo-location",
        {
          locationAlwaysAndWhenInUsePermission:
            "DVNT uses your location to show nearby events and suggest relevant venues while you are using the app.",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/notification-icon.png",
          color: "#ffffff",
          defaultChannel: "default",
        },
      ],
    ],
    scheme: "dvnt",
    experiments: {
      typedRoutes: true,
      // Disable experimental React canary/compiler in production to reduce startup crash risk
      reactCanary: !isProd,
      reactCompiler: !isProd,
    },
    extra: {
      ios: {
        widgetBundleIdentifier: "com.dvnt.app.DVNTHomeWidgetExtension",
        appGroupIdentifier: "group.com.dvnt.app",
      },
      router: {
        origin: routerOrigin,
      },
      fishjamAppId:
        process.env.EXPO_PUBLIC_FISHJAM_APP_ID ||
        process.env.FISHJAM_APP_ID ||
        fishjamAppIdFallback,
      eas: {
        projectId: "5c0d13a3-c544-4ffc-ae8f-8e897dda2663",
        build: {
          // Widget extension disabled — re-enable when live activity crash is fixed
          // experimental: {
          //   ios: {
          //     appExtensions: [
          //       {
          //         targetName: "DVNTHomeWidgetExtension",
          //         bundleIdentifier: "com.dvnt.app.DVNTHomeWidgetExtension",
          //         entitlements: {
          //           "com.apple.security.application-groups": [
          //             "group.com.dvnt.app",
          //           ],
          //         },
          //       },
          //     ],
          //   },
          // },
        },
      },
    },
  },
};
