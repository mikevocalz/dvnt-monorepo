import type { LynkState } from "@dvnt/app/lib/lynk/lynkState";
import type { ClassifiedError } from "../../errors";

/** Public copy only. Never surface raw relay, authorization, or backend errors. */
export function webJoinFeedback(error: ClassifiedError | null) {
  if (!error) return {
    title: "Couldn't join this Lynk",
    body: "Check your connection and try again. Your camera, microphone and identity choices are kept.",
    retry: true,
  };
  return {
    title: error.title,
    // Web has no capacity notification subscription. Do not promise auto-entry.
    body: error.reason === "room_full"
      ? "Every seat is taken right now. Try again in a moment to check for a space."
      : error.body,
    retry: error.reason === "unknown" || error.reason === "room_full" || error.reason === "rate_limited",
  };
}

export function webConnectionFeedback(state: LynkState) {
  switch (state) {
    case "live": return { label: "Connected", attention: false, detail: undefined };
    case "reconnecting": return { label: "Reconnecting", attention: true, detail: "Restoring your media connection. Your camera and microphone choices stay as you set them." };
    case "error": return { label: "Media unavailable", attention: true, detail: "Your media connection couldn't be established. Your controls are still below; leave and rejoin when you're ready." };
    case "ended": return { label: "Disconnected", attention: true, detail: "Your media connection has ended. You can leave using the controls below." };
    default: return { label: "Connecting media", attention: true, detail: "Connecting room audio and video. Your controls stay available below." };
  }
}
