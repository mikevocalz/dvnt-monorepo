// expo-callkit-telecom is an iOS/Android CallKit module pinned to an upstream
// git commit whose tarball ships no build/ output. Shared call code imports it
// unconditionally; on web every call site is behind Platform.OS === 'ios', so
// the no-op stub in packages/app/types is all this bundle needs.
export * from "@dvnt/app/types/expo-callkit-telecom";
