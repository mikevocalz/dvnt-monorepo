import { Platform } from "react-native";

const SettingsScreenIOS =
  require("@dvnt/app/components/settings/screens/SettingsScreen.ios").default;
const SettingsScreenAndroid =
  require("@dvnt/app/components/settings/screens/SettingsScreen.android").default;

const SettingsScreen =
  Platform.OS === "ios" ? SettingsScreenIOS : SettingsScreenAndroid;

export default SettingsScreen;
