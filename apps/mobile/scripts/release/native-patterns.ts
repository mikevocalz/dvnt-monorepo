/**
 * What counts as a native change — the single list.
 *
 * check-native-diff.ts and preflight-ota-safety.ts each carried their own copy
 * of this, and the copies had drifted: one anchored `package.json` at the repo
 * root, the other listed npm/yarn/bun lockfiles but not pnpm's, and neither
 * listed babel.config.js. A guardrail that disagrees with itself is one that
 * passes the thing it exists to stop.
 *
 * On 2026-09-08 adding a single line to eas.json's production build profile
 * moved the runtimeVersion off the hash every installed build asks for. Three
 * OTA updates then published successfully to an audience of nobody. Both
 * scripts ran clean, because the file that mattered matched neither list.
 *
 * Rule of thumb for adding here: if `eas fingerprint:compare` would report a
 * difference after touching the file, it belongs in this list.
 */

export interface NativePattern {
  pattern: RegExp;
  category: string;
}

export const NATIVE_PATTERNS: NativePattern[] = [
  { pattern: /^ios\//, category: "iOS native" },
  { pattern: /^android\//, category: "Android native" },
  { pattern: /Podfile(\.lock)?$/, category: "CocoaPods" },
  { pattern: /\.podspec$/, category: "Podspec" },
  { pattern: /build\.gradle/, category: "Android build" },
  { pattern: /AndroidManifest\.xml/, category: "Android manifest" },
  { pattern: /\.pbxproj$/, category: "Xcode project" },
  { pattern: /\.xcconfig$/, category: "Xcode config" },
  { pattern: /\.entitlements$/, category: "iOS entitlements" },
  { pattern: /\.swift$/, category: "Swift" },
  { pattern: /\.(m|mm|h)$/, category: "Objective-C" },
  { pattern: /\.kt$/, category: "Kotlin" },
  { pattern: /app\.config\.(ts|js)$/, category: "Expo config" },
  { pattern: /app\.json$/, category: "Expo config" },
  { pattern: /(^|\/)plugins\//, category: "Config plugin" },
  { pattern: /(^|\/)modules\//, category: "Native module" },
  { pattern: /expo-updates/, category: "expo-updates config" },

  // Any workspace's package.json, not just the root one. apps/mobile's own is
  // the file that moves this project's fingerprint, and the root anchor made
  // it invisible.
  { pattern: /(^|\/)package\.json$/, category: "Package deps" },

  // pnpm's lockfile ends in .yaml, so neither the /\.(lock|lockb)$/ rule nor
  // the explicit npm/yarn/bun entries ever matched it.
  {
    pattern: /(^|\/)(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb)$/,
    category: "Lockfile",
  },
  { pattern: /\.(lock|lockb)$/, category: "Lockfile" },

  // A fingerprint input. See the header.
  { pattern: /(^|\/)eas\.json$/, category: "EAS build config" },

  // Both change how the bundle is produced, and a babel plugin can pull in a
  // dependency that shifts autolinking — confirmed with
  // `eas fingerprint:compare` after adding babel-plugin-transform-remove-console.
  { pattern: /(^|\/)babel\.config\.(js|cjs|mjs|ts)$/, category: "Babel config" },
  { pattern: /(^|\/)metro\.config\.(js|cjs|mjs|ts)$/, category: "Metro config" },
];

/** First matching category, or null when the file is JS-only. */
export function nativeCategoryFor(file: string): string | null {
  return NATIVE_PATTERNS.find(({ pattern }) => pattern.test(file))?.category ?? null;
}
