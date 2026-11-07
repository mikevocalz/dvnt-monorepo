import type { EventLynkHostView } from "../../../lib/api/event-lynk";

export interface EventLynkCardProps {
  roomId: string;
  signedIn: boolean;
  mayHost: boolean;
  view: EventLynkHostView | null;
  isLoading: boolean;
  isError: boolean;
  isTerminal: boolean;
  isLive: boolean;
  isOpening: boolean;
  onOpen: () => void;
  onRetry: () => void;
}

/** Presentation only. Never infer room availability from an event's clock. */
export function eventLynkCardModel(p: EventLynkCardProps) {
  const host = p.signedIn && p.mayHost;
  const terminal = host && p.isTerminal;
  const live = host && p.isLive;
  const loading = host && p.isLoading && !p.view;
  const error = host && p.isError;
  return {
    host,
    terminal,
    live,
    loading,
    error,
    disabled: p.isOpening || terminal || loading,
    badge: terminal ? "Lynk ended" : live ? "Live now" : loading ? "Checking room" : error ? "Connection interrupted" : host ? (p.view?.state === "scheduled" ? "Scheduled" : p.view?.state === "ready" ? "Ready to start" : "Host access") : "Members only",
    title: terminal ? "Until the next Lynk" : live ? "Your room is live" : host ? "Bring your event together" : "Your event. Your people.",
    description: terminal ? "This room is closed. Check the event for what comes next." : host
      ? "You and accepted admin/editor co-organizers can start this event’s linked room."
      : "One room, linked to this event. Sign in with the account you use for your ticket or invitation.",
    action: terminal ? "This Lynk has ended" : p.isOpening ? (host && !live ? "Starting Lynk…" : "Opening Lynk…") : !p.signedIn ? "Sign in to join" : loading ? "Checking room…" : host && !live ? "Start event Lynk" : "Enter event Lynk",
    guidance: host ? "Starting opens the room. Guests join as access and available space allow."
      : "If the host hasn’t started, you’ll wait in this event’s room. Entry depends on event access, verification and available space.",
    showRoster: host && !!p.view && !error && !terminal && !live,
  };
}

export function eventLynkWaitingLabel(count: number) {
  return count === 0 ? "No one waiting yet" : `${count} ${count === 1 ? "person" : "people"} waiting`;
}
