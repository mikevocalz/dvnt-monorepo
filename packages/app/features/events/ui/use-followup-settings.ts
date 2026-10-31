import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getSessionLifecycle, subscribeSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { eventFollowupsApi } from "@dvnt/app/lib/api/event-followups";
import { createFollowupSettingsStore } from "@dvnt/app/lib/events/followup-settings";
const sessionEpoch = () => getSessionLifecycle().epoch;
export function useFollowupScope(eventId: number) {
  const owner = useAuthStore(s => s.user?.id);
  const epoch = useSyncExternalStore(subscribeSessionLifecycle, sessionEpoch, sessionEpoch);
  return `${eventId}:${owner ?? "guest"}:${epoch}`;
}
export function useFollowupSettings(eventId: number) {
  const ref = useRef<ReturnType<typeof createFollowupSettingsStore> | null>(null);
  if (!ref.current) ref.current = createFollowupSettingsStore(eventId, eventFollowupsApi);
  const controller = ref.current;
  const state = useStore(controller.store);
  useEffect(() => { controller.activate(); void controller.load(); return () => controller.dispose(); }, [controller]);
  return { ...state, toggle: controller.toggle, save: controller.save, reload: controller.load };
}
