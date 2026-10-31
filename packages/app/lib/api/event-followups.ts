import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { getSessionLifecycle } from "@dvnt/app/lib/auth/session-lifecycle";
import { describeFunctionError } from "./function-error";
import type { FollowupSettings } from "../events/followup-settings";

async function request(eventId: number, settings?: FollowupSettings): Promise<FollowupSettings> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw Error("Invalid event");
  const session = getSessionLifecycle();
  const owner = useAuthStore.getState().user;
  const token = await requireBetterAuthToken();
  if (!token || !owner || useAuthStore.getState().user !== owner || !session.ready || getSessionLifecycle() !== session) throw Error("Please sign in again before changing email settings.");
  const { data, error } = await supabase.functions.invoke(
    settings ? "event-followup-settings" : `event-followup-settings?event_id=${eventId}`,
    {
      method: settings ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
      ...(settings ? { body: { event_id: eventId, enabled: settings.enabled, subject: settings.subject,
        message: settings.message, cta_label: settings.cta_label, delay_minutes: settings.delay_minutes } } : {}),
    },
  );
  if (error) throw Error((await describeFunctionError(error)).message);
  const result = typeof data === "string" ? JSON.parse(data) : data;
  if (!result?.ok || !result.data) throw Error(result?.error || "Email settings unavailable");
  return result.data;
}
export const eventFollowupsApi = { load: (id: number) => request(id), save: (id: number, settings: FollowupSettings) => request(id, settings) };
