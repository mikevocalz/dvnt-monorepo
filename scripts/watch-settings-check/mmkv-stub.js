// In-memory stand-in for the MMKV-backed zustand storage, so the watch feature
// gate can be executed under node. Only used by scripts/verify-watch.mjs.
const { createJSONStorage } = require("zustand/middleware");

const map = new Map();
exports.mmkvStorage = createJSONStorage(() => ({
  getItem: (name) => map.get(name) ?? null,
  setItem: (name, value) => void map.set(name, value),
  removeItem: (name) => void map.delete(name),
}));
