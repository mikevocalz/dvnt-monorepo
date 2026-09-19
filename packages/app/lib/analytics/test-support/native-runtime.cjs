// Native boundaries for the crash-pipeline tests. The reporting, persistence
// lifecycle, envelope serializer, and theme hook themselves run unmodified.
const values = new Map();
exports.Platform = { OS: 'ios' };
exports.mmkv = {
  getString: (key) => values.get(key),
  set: (key, value) => values.set(key, value),
  remove: (key) => values.delete(key),
  clearAll: () => values.clear(),
};
exports.disk = { contents: null, removals: 0 };
exports.Paths = { document: 'file:///documents/' };
exports.File = class {
  get exists() { return exports.disk.contents !== null; }
  async text() { return exports.disk.contents; }
  delete() { exports.disk.contents = null; exports.disk.removals++; }
};
exports.analytics = { rows: [], fail: false };
exports.supabase = {
  from() {
    return {
      async insert(row) {
        exports.analytics.rows.push(row);
        if (exports.analytics.fail) throw new Error('analytics unavailable');
        return { error: null };
      },
    };
  },
};
exports.themeCalls = [];
exports.useColorScheme = () => ({
  setColorScheme(value) {
    // Reproduce DVNT-WEB-S at the actual boundary, not in the app helper.
    if (exports.Platform.OS === 'web') {
      throw new TypeError('Appearance.setColorScheme is not a function');
    }
    exports.themeCalls.push(value);
  },
});
