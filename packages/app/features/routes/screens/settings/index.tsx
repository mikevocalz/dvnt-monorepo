import { Platform } from "react-native";

const SettingsScreenIOS =
  require("@dvnt/app/features/settings").default;
const SettingsScreenAndroid =
  require("@dvnt/app/features/settings").default;

const SettingsScreen =
  Platform.OS === "ios" ? SettingsScreenIOS : SettingsScreenAndroid;

export default SettingsScreen;
