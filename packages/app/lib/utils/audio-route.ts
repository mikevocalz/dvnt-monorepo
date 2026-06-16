/**
 * Audio Route Utility
 *
 * Configures audio session to route audio through the speaker
 * during WebRTC calls.
 *
 * iOS: CallKeep setup has `defaultToSpeaker` (0x8) in categoryOptions,
 *      so speaker is the default when CallKit activates the audio session.
 *      Runtime toggle uses RNCallKeep.setAudioRoute().
 *
 * Android: Uses RNCallKeep.toggleAudioRouteSpeaker() for runtime toggle.
 */

import { Platform } from "react-native";
import RNCallKeep from "react-native-callkeep";

/**
 * Force audio output to speaker.
 *
 * @param callUUID - The active call UUID (used on Android for CallKeep routing)
 */
export function enableSpeakerphone(callUUID?: string): void {
  try {
    if (Platform.OS === "ios") {
      // iOS: use setAudioRoute which works on both platforms
      RNCallKeep.setAudioRoute(callUUID || "", "SPEAKER");
      console.log("[AudioRoute] Speaker enabled via CallKeep.setAudioRoute");
    } else {
      // Android: toggleAudioRouteSpeaker is Android-specific
      RNCallKeep.toggleAudioRouteSpeaker(callUUID || "", true);
      console.log("[AudioRoute] Speaker enabled via CallKeep (Android)");
    }
  } catch (e) {
    console.warn("[AudioRoute] enableSpeakerphone failed:", e);
  }
}

/**
 * Reset audio output to earpiece/default.
 *
 * @param callUUID - The active call UUID
 */
export function disableSpeakerphone(callUUID?: string): void {
  try {
    if (Platform.OS === "ios") {
      RNCallKeep.setAudioRoute(callUUID || "", "PHONE");
      console.log("[AudioRoute] Speaker disabled via CallKeep.setAudioRoute");
    } else {
      RNCallKeep.toggleAudioRouteSpeaker(callUUID || "", false);
      console.log("[AudioRoute] Speaker disabled via CallKeep (Android)");
    }
  } catch (e) {
    console.warn("[AudioRoute] disableSpeakerphone failed:", e);
  }
}
