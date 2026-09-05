/**
 * DVNT Apple Watch app — native SwiftUI, wired via @bacons/apple-targets (CNG).
 *
 * Generated shape mirrors `npx create-target watch`. Edit Swift here in
 * `targets/watch/`; `npx expo prebuild -p ios --clean` links it into the Xcode
 * project outside `/ios`.
 *
 * The watch is a thin presenter over the phone's ticket data. It never holds DVNT
 * auth — the phone pushes short-lived ticket payloads over WCSession, and the watch
 * caches them in its own App Group (shared with the complication target).
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "watch",
  // Target name MUST be unique across the Xcode project. It was "DVNT", the
  // same as the main app target, and EAS/fastlane maps provisioning profiles
  // BY TARGET NAME — so the watch's profile (com.dvnt.app.watchkitapp) was
  // applied to the phone app, failing the build with "has app ID
  // com.dvnt.app.watchkitapp, which does not match bundle ID com.dvnt.app"
  // plus a cascade of missing-capability errors (App Groups, Apple Pay,
  // Associated Domains, Push, Sign In with Apple — all the phone app's, none
  // of which the watch profile carries).
  // displayName keeps the user-visible name on the watch as "DVNT"
  // (INFOPLIST_KEY_CFBundleDisplayName falls back to `name` when unset).
  name: "DVNTWatch",
  displayName: "DVNT",
  // Watch app needs its own bundle id; keep it under the phone app's namespace.
  bundleIdentifier: "com.dvnt.app.watchkitapp",
  deploymentTarget: "10.0",
  // App icon for the watch home screen. MUST be square: watchOS masks the icon
  // into a circle, so a non-square source is squashed to fit. This pointed at
  // dvnt-glyph.png, which is 2816x1536 (1.83:1) despite the old comment calling
  // it square — the watch icon came out distorted and did not match the phone.
  // ios-icon.png is the phone's own 1024x1024 icon, so the two now match.
  icon: "../../assets/images/ios-icon.png",
  // App Group shared between the watch app and the watch complication (per-device
  // container — the watch CANNOT read the iPhone's group, hence WCSession transport).
  entitlements: {
    "com.apple.security.application-groups": ["group.com.dvnt.app.watch"],
  },
  // NEVER add CoreImage here. It does not exist in the watchOS SDK, and listing
  // it puts CoreImage.framework in the target's Frameworks build phase — which
  // fails at LINK time, after every compile has succeeded. Dropping the Swift
  // `import CoreImage` is not enough on its own; this list is the second half.
  // The ticket QR is encoded on the phone and shipped as `qrMatrix` instead.
  frameworks: ["SwiftUI", "WatchConnectivity", "WatchKit", "UserNotifications"],
  // The real brand wordmark. apple-targets >=3 rasterizes target `images` through
  // @expo/image-utils, which rejects SVG ("Invalid mimeType") — so reference a PNG
  // rasterized from DVNT-logo-grad-white.svg (the full 2360x908 wordmark, transparent
  // bg so the white glyphs show on the watch's black canvas; gradient "V" intact).
  // Do NOT redraw the logo; regenerate the PNG from the SVG if the brand changes.
  images: {
    dvntLogo: "../../assets/images/DVNT-logo-grad-white.png",
  },
  // Exact DVNT brand stops (see docs/dvnt-design-system.md). Used by Theme.swift.
  colors: {
    $accentColor: "#3397ce",
    brandTealDeep: "#0f4961",
    brandTeal: "#2f8ec1",
    brandTealBright: "#379ed8",
    brandPurpleDeep: "#5b2c81",
    brandPurple: "#874e9f",
    canvas: "#000000",
  },
};
