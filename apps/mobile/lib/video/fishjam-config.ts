import Constants from "expo-constants";

export const DEFAULT_FISHJAM_APP_ID =
  "28026441819941d78c40584fb830f851";

export function resolveFishjamAppId(): string {
  return (
    Constants.expoConfig?.extra?.fishjamAppId ??
    process.env.EXPO_PUBLIC_FISHJAM_APP_ID ??
    DEFAULT_FISHJAM_APP_ID
  );
}
