import { useCallback } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useWatchSessionStore } from "./watch-session-store";
import { useWatchSettingsStore } from "./watch-settings-store";
import { executeVenueCommand, validateVenueCommand, type VenueOperation, type WatchVenueResult } from "./watch-venue-actions";

const operations = create<{ generation: string; entries: Record<string, VenueOperation> }>()(persist(() => ({ generation: "", entries: {} }), { name: "watch-venue-operations", storage: mmkvStorage }));
export function useWatchVenueActions() {
  const viewer = useAuthStore(s => s.user?.id);
  const generation = useWatchSessionStore(s => s.accountGen);
  const handleCommand = useCallback(async (raw: unknown): Promise<WatchVenueResult> => {
    const command = validateVenueCommand(raw, generation);
    const input = raw as Partial<{ operationId: string; eventId: string }> | null;
    const reject = (message: string): WatchVenueResult => ({ protocol: 2, accountGen: generation, operationId: input?.operationId ?? "", eventId: input?.eventId ?? "", status: "rejected", message });
    const settings = useWatchSettingsStore.getState();
    if (!command || !viewer || !settings.enabled || !(command.action === "notice" ? settings.door && settings.broadcasts : settings.tickets)) return reject("Action unavailable. Sync and retry.");
    const assertCurrent = () => {
      if (useAuthStore.getState().user?.id !== viewer || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed");
    };
    try {
      assertCurrent();
      const token = await requireBetterAuthToken();
      assertCurrent();
      if (Date.now() / 1000 >= command.expiresAt) return reject("Request expired. Try again.");
      if (operations.getState().generation !== generation) operations.setState({ generation, entries: {} });
      if (!operations.getState().entries[command.operationId] && Object.keys(operations.getState().entries).length >= 500) return reject("Watch action history is full. Continue on your phone.");
      return await executeVenueCommand(command, {
        get: id => operations.getState().entries[id],
        put: (id, operation) => { assertCurrent(); operations.setState({ entries: { ...operations.getState().entries, [id]: operation } }); },
        assertCurrent,
        write: async () => {
          assertCurrent();
          if (Date.now() / 1000 >= command.expiresAt) throw new Error("Expired");
          const name = command.action === "notice" ? "event-broadcast-message" : "event-presence";
          const body = command.action === "notice" ? { event_id: Number(command.eventId), body: command.body!.trim(), audience: command.audience }
            : { event_id: Number(command.eventId), ticket_id: command.ticketId, action: command.state === "revoke" ? "revoke" : "report", ...(command.state !== "revoke" ? { state: command.state } : {}) };
          // Captured credentials ensure an account switch cannot retarget this write.
          // The edge functions enforce ticket ownership and owner/admin authorization.
          const result = await supabase.functions.invoke(name, { headers: { Authorization: `Bearer ${token}`, "x-auth-token": token }, body });
          assertCurrent();
          return { confirmed: !result.error && result.data?.ok === true,
            message: command.action === "notice" && result.data?.data?.notified === 0 ? "No attendees matched this audience" : undefined };
        },
      });
    } catch { return reject("Account or connection changed. Check your phone."); }
  }, [viewer, generation]);
  return { handleCommand };
}
