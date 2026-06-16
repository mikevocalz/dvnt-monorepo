/**
 * Web stub for the ExpoMediaLibraryNext NATIVE module only. expo-media-library
 * itself has web support (ExpoMediaLibrary.web.ts), but its newer
 * `ExpoMediaLibraryNext` module is imported unconditionally by index.ts and has
 * no web build, so it throws `Cannot find native module 'ExpoMediaLibraryNext'`
 * and crashes any screen that pulls the package in (e.g. via the hooks barrel).
 *
 * On web there's no OS photo-library API; actual media PICKING is done with the
 * React/browser equivalent (expo-image-picker → <input type=file> on web), so
 * here permissions report GRANTED (a user-initiated file picker needs none) and
 * the Asset/Album/Query classes are inert. Mapped in via NormalModuleReplacement.
 */
const granted = {
  status: "granted" as const,
  granted: true,
  canAskAgain: true,
  expires: "never" as const,
};

class Asset {}
class Album {}
class Query {}

const ExpoMediaLibraryNext = {
  Asset,
  Album,
  Query,
  async requestPermissionsAsync() {
    return granted;
  },
  async getPermissionsAsync() {
    return granted;
  },
  async presentPermissionsPicker() {},
  addListener() {
    return { remove() {} };
  },
  removeAllListeners() {},
};

export default ExpoMediaLibraryNext;
