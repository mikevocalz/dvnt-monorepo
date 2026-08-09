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
  // Shown in the watch-face complication picker — the target name would
  // otherwise leak there verbatim.
  displayName: "DVNT",
  // NOTE: ".complications" (plural), not ".complication". Apple permanently
  // reserves an App ID string once it has been created and deleted — the
  // singular form was registered during the June attempt, removed, and has
  // been refused ever since with "An App ID with Identifier ... is not
  // available", even on an authenticated cookie session. The string is burned;
  // it cannot be recovered. Must stay a child of the watch app's bundle id.
  bundleIdentifier: "com.dvnt.app.watchkitapp.complications",
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
