// Web stub for react-native-reanimated/scripts/validate-worklets-version.
// The real script is CommonJS (`module.exports = validateVersion`) and runs at
// reanimated's module-init time. When reanimated is in Vite's optimizeDeps.exclude,
// Vite serves it as raw ESM and the `import validateWorkletsVersion from ...` default
// import fails ("does not provide an export named 'default'"), crashing app startup.
// Worklets-version validation is irrelevant on web, so we always report ok.
// Must match the real script's return shape: `{ ok: boolean; message?: string }`
// (reanimated's assertWorkletsVersion reads `result.ok`).
export default function validateWorkletsVersion(
  _reanimatedVersion?: string,
): { ok: boolean; message?: string } {
  return { ok: true }
}
