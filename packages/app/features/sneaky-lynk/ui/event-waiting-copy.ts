import type { EventWaitingStatus } from "../hooks/useEventLynkWaitingRoom";

/** Shared, privacy-safe copy: no title, roster, queue position or seat promise. */
export function eventWaitingCopy(status: EventWaitingStatus) {
  return {
    eyebrow: "EVENT LYNK · LOBBY",
    title: status === "ready" ? "The host has started" : status === "reconnecting" ? "Getting you back" : "You're early. Settle in.",
    status: status === "checking" ? "Checking the host's status…" : status === "reconnecting" ? "Connection interrupted. We'll check again automatically." : status === "ready" ? "Checking room access and available space…" : status === "stopped" ? "You have left the lobby." : "Connected to the lobby · Waiting for the host",
    body: "When the host starts, we'll try to join with your reviewed choices. Entry still depends on access and available space.",
    privacy: "Your camera and microphone stay off while you wait.",
    capacity: "This lobby isn't a queue or a reserved seat.",
  };
}

/** Retain the server's reason underneath; only classify unambiguous endings. */
export function roomUnavailableTitle(message?: string | null) {
  if (/\bended\b|\bexpired\b/i.test(message || "")) return "This Lynk has ended";
  if (/ticket|invitation|access|account|unauthorized|permission/i.test(message || "")) return "Room access unavailable";
  return "This Lynk is unavailable";
}
