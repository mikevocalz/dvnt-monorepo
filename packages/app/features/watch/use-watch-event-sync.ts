import { projectWatchMoments, type EventMomentRow } from "./watch-event-moments";
import { loadEventRelationPages as allEventRelations, eventWindowPage } from "./watch-event-pages";
/**
 * PLATFORM BEHAVIOR: phone-owned event reads and mutations; watch envelopes have
 * no credentials. Sources use their actual identity keys, independent of tickets.
 * STOP-THE-LINE: account-bound checks bracket every auth await; pending operations
 * survive process death and are never silently repeated after an uncertain write.
 */
import { createWatchVenueWeatherLoader } from "./watch-event-weather";
import { fetchLiveSurface } from "../live-surface/api";
import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Platform } from "react-native";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { useWatchSessionStore } from "./watch-session-store";
import { useWatchSettingsStore } from "./watch-settings-store";
import { buildWatchEvents, validateEventCommand, type WatchEventEnvelope, type WatchEventRelations, type WatchEventResult, type WatchEventRow } from "./watch-event-payload";

let eventWindow = { generation: "", offset: 0, momentEventId: undefined as string | undefined };
const enrichVenueWeather = createWatchVenueWeatherLoader(fetchLiveSurface);

interface EventOperations {
  accountGen: string;
  entries: Record<string, WatchEventResult | "pending">;
  select: (generation: string) => void;
  put: (id: string, result: WatchEventResult | "pending") => void;
}
const useEventOperations = create<EventOperations>()(persist((set, get) => ({
  accountGen: "", entries: {},
  select: (accountGen) => { if (get().accountGen !== accountGen) set({ accountGen, entries: {} }); },
  put: (id, result) => set({ entries: Object.fromEntries(Object.entries({ ...get().entries, [id]: result }).slice(-80)) }),
}), { name: "watch-event-operations", storage: mmkvStorage }));

function assertAccount(viewerId: string, accountGen: string) {
  if (!viewerId || useAuthStore.getState().user?.id !== viewerId || useWatchSessionStore.getState().accountGen !== accountGen) {
    throw new Error("Account changed. Sync your watch again.");
  }
}

async function eventIdentity(viewerId: string, accountGen: string) {
  assertAccount(viewerId, accountGen);
  const column = /^[1-9][0-9]*$/.test(viewerId) ? "id" : "auth_id";
  const row = await supabase.from("users").select("id,auth_id").eq(column, viewerId).single();
  assertAccount(viewerId, accountGen);
  if (row.error || !row.data?.auth_id) throw new Error("Sign in on your phone to sync events.");
  return { authId: String(row.data.auth_id), integerId: Number(row.data.id) };
}

export async function loadWatchEventEnvelope(viewerId: string, accountGen: string): Promise<WatchEventEnvelope> {
  assertAccount(viewerId, accountGen);
  const { authId, integerId } = await eventIdentity(viewerId, accountGen);
  if (!authId || !integerId) throw new Error("Sign in on your phone to sync events.");
  if (eventWindow.generation !== accountGen) eventWindow = { generation: accountGen, offset: 0, momentEventId: undefined };
  const [rsvps, invitations, likes, waitlist, hosted] = await Promise.all([
    allEventRelations(() => supabase.from("event_rsvps").select("event_id,status").eq("user_id", authId).order("created_at", { ascending: false }).order("id", { ascending: false })),
    allEventRelations(() => supabase.from("event_invites").select("event_id,status").eq("invited_user_id", authId).order("created_at", { ascending: false }).order("id", { ascending: false })),
    allEventRelations(() => supabase.from("event_likes").select("event_id").eq("user_id", integerId).order("created_at", { ascending: false }).order("id", { ascending: false })),
    allEventRelations(() => supabase.from("event_waitlist").select("event_id,ticket_type_id,offer_status,offer_expires_at").eq("user_id", authId).order("created_at", { ascending: false }).order("id", { ascending: false })),
    allEventRelations(() => supabase.from("events").select("id").eq("host_id", authId).order("start_date", { ascending: false }).order("id", { ascending: false })),
  ]);
  assertAccount(viewerId, accountGen);
  for (const result of [rsvps, invitations, likes, waitlist, hosted]) if (result.error) throw result.error;
  const ids = [...new Set([
    ...(rsvps.data ?? []).map((r) => r.event_id), ...(invitations.data ?? []).map((r) => r.event_id),
    ...(likes.data ?? []).map((r) => r.event_id), ...(waitlist.data ?? []).map((r) => r.event_id), ...(hosted.data ?? []).map((r) => r.id),
  ])];
  if (!ids.length) return { protocol: 2, accountGen, syncedAt: Date.now() / 1000, events: [], status: "ready" };
  const eventRows: WatchEventRow[] = [];
  const tierRows: WatchEventRelations["tiers"] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    assertAccount(viewerId, accountGen);
    const batch = ids.slice(offset, offset + 100);
    const [eventPage, tierPage] = await Promise.all([
      supabase.from("events").select("id,title,start_date,end_date,event_tz,cover_image_url,flyer_image_url,video_poster_url,location,location_name,location_lat,location_lng,is_online,status,ticketing_enabled,host_id").in("id", batch),
      allEventRelations(() => supabase.from("ticket_types").select("id,event_id,quantity_total,quantity_sold,sale_start,sale_end,tier_visibility").in("event_id", batch).order("id")),
    ]);
    if (eventPage.error) throw eventPage.error;
    if (tierPage.error) throw tierPage.error;
    eventRows.push(...(eventPage.data ?? []) as WatchEventRow[]);
    tierRows.push(...tierPage.data);
  }
  const events = { data: eventRows, error: null };
  const tiers = { data: tierRows, error: null };
  if (events.error) throw events.error;
  if (tiers.error) throw tiers.error;
  assertAccount(viewerId, accountGen);
  const relations: WatchEventRelations = { authId, rsvps: rsvps.data ?? [], invitations: invitations.data ?? [], likes: likes.data ?? [], waitlist: waitlist.data ?? [], tiers: tiers.data };
  const now = Date.now();
  const rows = buildWatchEvents((events.data ?? []) as WatchEventRow[], relations, now).sort((a, b) => {
    const timeA = Date.parse(a.endAt ?? a.startAt ?? "") || 0;
    const timeB = Date.parse(b.endAt ?? b.startAt ?? "") || 0;
    const pastA = timeA > 0 && timeA < now;
    const pastB = timeB > 0 && timeB < now;
    return pastA !== pastB ? (pastA ? 1 : -1) : pastA ? timeB - timeA : timeA - timeB;
  });
  // Keep the near-term focus stable while browsing bounded historical pages.
  // The transport has a hard size limit; accumulating the full archive is unsafe.
  const page = eventWindowPage(rows, eventWindow.offset);
  if (eventWindow.momentEventId) {
    const event = page.events.find(row => row.id === eventWindow.momentEventId);
    if (event) {
      event.moments = [];
      event.momentsStatus = "unavailable";
      try {
        const blocked = await allEventRelations(() => supabase.from("blocks").select("id,blocker_id,blocked_id")
          .or(`blocker_id.eq.${integerId},blocked_id.eq.${integerId}`).order("id"));
        if (blocked.error) throw blocked.error;
        const excluded = new Set(blocked.data.map(row => String(Number(row.blocker_id) === integerId ? row.blocked_id : row.blocker_id)));
        for (let offset = 0; ; offset += 30) {
          assertAccount(viewerId, accountGen);
          const result = await supabase.from("event_moments").select("id,user_id,media_url,media_type,expires_at,is_flagged")
            .eq("event_id", Number(event.id)).eq("media_type", "photo").eq("is_flagged", false).gt("expires_at", new Date(now).toISOString())
            .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + 29);
          if (result.error) throw result.error;
          event.moments.push(...projectWatchMoments((result.data ?? []) as EventMomentRow[], excluded, now));
          event.moments = event.moments.slice(0, 6);
          if (event.moments.length >= 6 || (result.data?.length ?? 0) < 30) break;
        }
        assertAccount(viewerId, accountGen);
        event.momentsStatus = "ready";
      } catch {
        // A block/privacy read failure must not preserve previously permitted photos.
        event.moments = []; event.momentsStatus = "unavailable";
      }
    }
  }
  const enriched = await enrichVenueWeather(page.events, accountGen, () => useAuthStore.getState().user?.id === viewerId && useWatchSessionStore.getState().accountGen === accountGen, now);
  assertAccount(viewerId, accountGen);
  return { protocol: 2, accountGen, syncedAt: now / 1000, events: enriched, hasMore: page.hasMore, hasPrevious: page.hasPrevious, status: "ready" };
}

export interface WatchEventTransport {
  push: (envelope: WatchEventEnvelope) => Promise<void>;
  openOnPhone: (eventId: string) => Promise<boolean>;
}

export function useWatchEventSync({ push, openOnPhone }: WatchEventTransport) {
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const enabled = useWatchSettingsStore((s) => s.enabled);
  const accountGen = useWatchSessionStore((s) => s.accountGen);
  const queryClient = useQueryClient();
  const key = ["watch-events", viewerId, accountGen];
  const query = useQuery({ queryKey: key, queryFn: () => loadWatchEventEnvelope(viewerId!, accountGen),
    enabled: !!viewerId && !!accountGen && enabled && Platform.OS !== "web", refetchInterval: 60_000 });

  useEffect(() => {
    const generation = useWatchSessionStore.getState().selectAccount(viewerId);
    useEventOperations.getState().select(generation);
    if (!viewerId || !enabled) void push({ protocol: 2, accountGen: generation, syncedAt: Date.now() / 1000, events: [], status: "ready" });
  }, [viewerId, enabled, push]);
  useEffect(() => {
    if (query.data && enabled && query.data.accountGen === accountGen) void push(query.data);
  }, [query.data, enabled, accountGen, push]);
  useEffect(() => {
    if (query.error && viewerId && enabled) void push({ protocol: 2, accountGen, syncedAt: Date.now() / 1000, events: [], status: "error", error: "Couldn’t refresh events. Your saved snapshot remains available." });
  }, [query.error, viewerId, enabled, accountGen, push]);

  const refresh = useCallback(async () => { await queryClient.invalidateQueries({ queryKey: ["watch-events"] }); }, [queryClient]);
  const handleCommand = useCallback(async (raw: unknown): Promise<WatchEventResult> => {
    const command = validateEventCommand(raw, accountGen);
    const fallback = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const base = { protocol: 2 as const, accountGen, operationId: String(fallback.operationId ?? ""), eventId: String(fallback.eventId ?? "") };
    if (!command || !viewerId || !enabled) return { ...base, status: "rejected", message: "Request expired or unavailable. Sync and retry." };
    const ledger = useEventOperations.getState();
    ledger.select(accountGen);
    const prior = useEventOperations.getState().entries[command.operationId];
    if (prior) return prior === "pending" ? { ...base, status: "failed", message: "Result not confirmed. Open the event on your phone before trying again." } : prior;
    ledger.put(command.operationId, "pending");
    try {
      assertAccount(viewerId, accountGen);
      const fresh = await loadWatchEventEnvelope(viewerId, accountGen);
      const event = fresh.events.find((item) => item.id === command.eventId);
      if (!event) throw new Error("This event is no longer available.");
      if (command.action === "archive_more" || command.action === "archive_previous" || command.action === "load_moments") {
        if (command.action === "load_moments") eventWindow.momentEventId = command.eventId;
        else eventWindow.offset = Math.max(0, eventWindow.offset + (command.action === "archive_more" ? 40 : -40));
        const expanded = await loadWatchEventEnvelope(viewerId, accountGen);
        assertAccount(viewerId, accountGen);
        await push(expanded);
        const result: WatchEventResult = { ...base, status: "confirmed", message: command.action === "load_moments" ? "Event moments refreshed" : "Events loaded" };
        useEventOperations.getState().put(command.operationId, result);
        return result;
      }
      const { authId } = await eventIdentity(viewerId, accountGen);
      const token = await requireBetterAuthToken();
      assertAccount(viewerId, accountGen);
      if (!authId || Date.now() / 1000 >= command.expiresAt) throw new Error("Request expired. Try again.");
      const headers = { Authorization: `Bearer ${token}`, "x-auth-token": token };
      if (command.action === "open_on_phone") {
        if (!await openOnPhone(event.id)) throw new Error("Open DVNT on your phone to continue.");
      } else {
        if (event.status !== "active" || (event.endAt && Date.parse(event.endAt) <= Date.now())) throw new Error("This event is no longer accepting changes.");
        if (command.action.startsWith("waitlist_")) {
          if (command.action === "waitlist_join" && (!event.canJoinWaitlist || command.ticketTypeId !== undefined)) throw new Error("Open the event on your phone to choose a ticket.");
          if (command.action === "waitlist_leave" && !event.waitlist.some((row) => row.ticketTypeId === command.ticketTypeId)) throw new Error("This waitlist entry is no longer available.");
          const result = await supabase.functions.invoke("event-waitlist", { headers, body: {
            action: command.action === "waitlist_join" ? "join" : "leave", event_id: Number(event.id), ticket_type_id: command.ticketTypeId ?? null,
          } });
          if (result.error || result.data?.ok !== true) throw new Error("Couldn’t confirm the waitlist change. Check on your phone.");
        } else {
          if (event.inviteStatus === "pending" || (command.action === "going" && event.ticketingEnabled)) throw new Error("Continue on your phone to complete this invitation or ticket.");
          // Same verified auth-id keyed flow as eventsApi.rsvpEvent. Keeping the
          // captured user ID in the write prevents an account switch retargeting it.
          const existing = await supabase.from("event_rsvps").select("id").eq("event_id", Number(event.id)).eq("user_id", authId).maybeSingle();
          if (existing.error) throw existing.error;
          assertAccount(viewerId, accountGen);
          if (Date.now() / 1000 >= command.expiresAt) throw new Error("Request expired. Try again.");
          const update = existing.data
            ? await supabase.from("event_rsvps").update({ status: command.action }).eq("id", existing.data.id).eq("user_id", authId).select("status").single()
            : await supabase.from("event_rsvps").insert({ event_id: Number(event.id), user_id: authId, status: command.action }).select("status").single();
          if (update.error || update.data?.status !== command.action) throw new Error("Couldn’t confirm your RSVP. Check on your phone.");
          if (command.action === "going") {
            assertAccount(viewerId, accountGen);
            const ticket = await supabase.functions.invoke("rsvp-issue-ticket", { headers, body: { eventId: Number(event.id) } });
            if (ticket.error || ticket.data?.ok !== true) throw new Error("Your RSVP was saved. Open the event on your phone to confirm your pass.");
          }
        }
      }
      assertAccount(viewerId, accountGen);
      const result: WatchEventResult = { ...base, status: "confirmed", message: command.action === "open_on_phone" ? "Opened on your phone" : "Confirmed" };
      useEventOperations.getState().put(command.operationId, result);
      void refresh();
      return result;
    } catch (error) {
      const result: WatchEventResult = { ...base, status: "failed", message: error instanceof Error ? error.message : "Couldn’t confirm this change. Retry on your phone." };
      if (useWatchSessionStore.getState().accountGen === accountGen) useEventOperations.getState().put(command.operationId, result);
      return result;
    }
  }, [accountGen, viewerId, enabled, openOnPhone, refresh, push]);
  return { handleCommand, refresh, envelope: query.data };
}
