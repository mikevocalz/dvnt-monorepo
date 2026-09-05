import { useWatchDoorSync } from "./use-watch-door-sync";
import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useRouter } from "expo-router";
import { useWatchVenueActions } from "./use-watch-venue-actions";
import { useWatchCallDirectory } from "./use-watch-call-directory";
import { useWatchEventSync } from "./use-watch-event-sync";
import { registerWatchDoorHandler, syncDoorToWatch, registerWatchVenueHandler, registerWatchEventHandler, syncEventsToWatch, registerWatchCallDirectoryHandler, syncCallDirectoryToWatch } from "./watch-bridge";

/** Event continuation only confirms navigation while the phone UI is active. */
export function useWatchEvents() {
  const { refresh: refreshDoor } = useWatchDoorSync(syncDoorToWatch);
  useEffect(() => registerWatchDoorHandler(refreshDoor), [refreshDoor]);
  const router = useRouter();
  const { handleCommand: venueCommand } = useWatchVenueActions();
  useEffect(() => registerWatchVenueHandler(venueCommand), [venueCommand]);
  const openOnPhone = useCallback(async (eventId: string) => {
    if (AppState.currentState !== "active") return false;
    router.push(`/(protected)/events/${eventId}` as never);
    return true;
  }, [router]);
  const { handleCommand, refresh } = useWatchEventSync({ push: syncEventsToWatch, openOnPhone });
  useEffect(() => registerWatchEventHandler(handleCommand, refresh), [handleCommand, refresh]);
}

export function useWatchCalls() {
  const router = useRouter();
  const openOnPhone = useCallback(async (params: { participantIds: string[]; callType: "audio" | "video"; recipientUsername: string }) => {
    if (AppState.currentState !== "active") return false;
    router.push({ pathname: "/(protected)/call/[roomId]", params: { roomId: "new", isOutgoing: "true",
      isGroup: params.participantIds.length > 1 ? "true" : "false", participantIds: params.participantIds.join(","),
      callType: params.callType, recipientUsername: params.recipientUsername } });
    return true;
  }, [router]);
  const { handleCommand, refresh } = useWatchCallDirectory({ push: syncCallDirectoryToWatch, openOnPhone });
  useEffect(() => registerWatchCallDirectoryHandler(handleCommand, refresh), [handleCommand, refresh]);
}
