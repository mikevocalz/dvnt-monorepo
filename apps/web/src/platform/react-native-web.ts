// @ts-ignore react-native-web does not publish a declaration entry for this direct wrapper import.
export * from "react-native-web";

export const PermissionsAndroid = {
  PERMISSIONS: {
    CALL_PHONE: "android.permission.CALL_PHONE",
    CAMERA: "android.permission.CAMERA",
    READ_PHONE_NUMBERS: "android.permission.READ_PHONE_NUMBERS",
    READ_PHONE_STATE: "android.permission.READ_PHONE_STATE",
    RECORD_AUDIO: "android.permission.RECORD_AUDIO",
  },
  RESULTS: {
    DENIED: "denied",
    GRANTED: "granted",
    NEVER_ASK_AGAIN: "never_ask_again",
  },
  check: async () => false,
  request: async () => "denied",
  requestMultiple: async (permissions: string[]) =>
    Object.fromEntries(permissions.map((permission) => [permission, "denied"])),
};
