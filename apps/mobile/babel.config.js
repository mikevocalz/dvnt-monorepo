module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      // No jsxImportSource: that was the NativeWind v4 setup and v5 ships no
      // jsx-runtime at all, so every transformed file (including Expo's own
      // sources under node_modules) asked Metro for a module that does not
      // exist. v5 styles via its Metro transformer + react-native-css instead.
      ["babel-preset-expo", { unstable_transformImportMeta: true }],
    ],
    plugins: [
      "react-native-worklets/plugin",
    ],
  };
};
