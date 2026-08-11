// Stubs for verify-presence.mjs — the functions under test are pure geometry,
// so the native modules they sit beside never need to exist here.
module.exports = {
  getForegroundPermissionsAsync: async () => ({ granted: false }),
  getCurrentPositionAsync: async () => ({ coords: { latitude: 0, longitude: 0 } }),
  Accuracy: { Balanced: 3 },
  invokeEdge: async () => ({ error: null }),
};
