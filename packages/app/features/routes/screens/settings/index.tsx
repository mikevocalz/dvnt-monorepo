import { Platform } from "react-native";

// Deep requires on purpose: features/settings has no barrel (it is a folder of
// .web.tsx screens plus ui/), and these two are the only native entry points.
// The WS-6 codemod rewrote both to "@dvnt/app/features/settings", which Metro
// cannot resolve — package exports do no directory-index lookup — so the
// production bundle failed here. eslint-disable is the same sanctioned residual
// WS-6 used for its other two unroutable cases.
// eslint-disable-next-line no-restricted-imports
const SettingsScreenIOS =
  require("@dvnt/app/features/settings/ui/screens/SettingsScreen.ios").default;
// eslint-disable-next-line no-restricted-imports
const SettingsScreenAndroid =
  require("@dvnt/app/features/settings/ui/screens/SettingsScreen.android")
    .default;

const SettingsScreen =
  Platform.OS === "ios" ? SettingsScreenIOS : SettingsScreenAndroid;

export default SettingsScreen;
