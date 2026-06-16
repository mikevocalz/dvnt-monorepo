// Stubs react-native-reanimated's worklets-version compatibility check on web.
// Reanimated 4's runtime `assertWorkletsVersion()` calls this and throws unless
// the result is `{ ok: true }` — an older shim returned a bare `true`, whose
// `.ok` is undefined, so reanimated threw on every web load. Return the shape
// the caller expects. (The native build does its own real check.)
export default function validateWorkletsVersion(): { ok: boolean; message?: string } {
  return { ok: true };
}
