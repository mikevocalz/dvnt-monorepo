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
  name: "DVNT",
  // Watch app needs its own bundle id; keep it under the phone app's namespace.
  bundleIdentifier: "com.dvnt.app.watchkitapp",
  deploymentTarget: "10.0",
  // App icon for the watch home screen (square glyph — re-used from the phone assets).
  icon: "../../assets/images/dvnt-glyph.png",
  // App Group shared between the watch app and the watch complication (per-device
  // container — the watch CANNOT read the iPhone's group, hence WCSession transport).
  entitlements: {
    "com.apple.security.application-groups": ["group.com.dvnt.app.watch"],
  },
  frameworks: ["SwiftUI", "WatchConnectivity", "CoreImage", "WatchKit", "UserNotifications"],
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
