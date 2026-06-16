/**
 * DVNT watch-face complication (WidgetKit, watchOS accessory families).
 *
 * Shares the watch App Group with the watch app so it reads the same cached
 * ticket set (no network of its own). Shows the next event countdown / a
 * "tap to show ticket" glyph — the killer glance.
 *
 * NOTE: complications run inside a widget extension that must be embedded in the
 * *watch* app, not the phone app. After `expo prebuild`, verify in Xcode that this
 * target's "Embed App Extensions" host is the DVNT watch app (apple-targets wires
 * the common case; watch-embedded widget extensions are the one spot to eyeball).
 *
 * @type {import('@bacons/apple-targets/app.plugin').Config}
 */
module.exports = {
  type: "widget",
  name: "DVNTWatchComplication",
  bundleIdentifier: "com.dvnt.app.watchkitapp.complication",
  deploymentTarget: "10.0",
  entitlements: {
    "com.apple.security.application-groups": ["group.com.dvnt.app.watch"],
  },
  frameworks: ["SwiftUI", "WidgetKit"],
  // Monochrome glyph for the circular/corner families (tints via .widgetAccentable()).
  images: {
    Glyph: "../../assets/images/dvnt-glyph.png",
  },
  colors: {
    $accentColor: "#3397ce",
  },
};
