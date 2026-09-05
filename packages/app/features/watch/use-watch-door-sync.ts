import { useCallback, useEffect } from "react";
import { Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useWatchSessionStore } from "./watch-session-store";
import { useWatchSettingsStore } from "./watch-settings-store";
import { authoritativeDoor, type WatchDoorEnvelope } from "./watch-door-payload";

function assertViewer(viewer: string, generation: string) {
  if (useAuthStore.getState().user?.id !== viewer || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed.");
}
export async function loadWatchDoor(viewer: string, generation: string): Promise<WatchDoorEnvelope> {
  assertViewer(viewer, generation);
  const identity = await supabase.from("users").select("auth_id").eq(/^[0-9]+$/.test(viewer) ? "id" : "auth_id", viewer).single();
  assertViewer(viewer, generation);
  if (identity.error || !identity.data?.auth_id) throw new Error("Sign in on your phone.");
  const authId = identity.data.auth_id;
  const operationalEnd = new Date(Date.now() + 12 * 3600_000).toISOString();
  const [owned, roles] = await Promise.all([
    supabase.from("events").select("id,title,start_date,end_date,status", { count: "exact" }).eq("host_id", authId).eq("status", "active").lte("start_date", operationalEnd).order("start_date", { ascending: false }).limit(100),
    supabase.from("event_co_organizers").select("event_id", { count: "exact" }).eq("user_id", authId).eq("accepted", true).in("role", ["admin", "editor", "scanner"]).limit(500),
  ]);
  assertViewer(viewer, generation);
  if (owned.error) throw owned.error;
  if (roles.error) throw roles.error;
  if ((owned.count ?? 0) > (owned.data?.length ?? 0) || (roles.count ?? 0) > (roles.data?.length ?? 0)) throw new Error("Open the host dashboard on your phone to choose an event.");
  let events = owned.data ?? [];
  const ids = [...new Set((roles.data ?? []).map((r) => r.event_id))];
  if (ids.length) {
    const shared = await supabase.from("events").select("id,title,start_date,end_date,status").in("id", ids).eq("status", "active");
    assertViewer(viewer, generation);
    if (shared.error) throw shared.error;
    events = [...events, ...(shared.data ?? [])];
  }
  const now = Date.now();
  const candidates = events.filter((e) => {
    const start = Date.parse(e.start_date ?? ""); const end = Date.parse(e.end_date ?? "");
    return Number.isFinite(start) && start <= now + 12 * 3600_000 && (Number.isFinite(end) ? end > now : start >= now - 6 * 3600_000);
  }).sort((a, b) => Date.parse(a.start_date!) - Date.parse(b.start_date!));
  const focus = candidates[0];
  if (!focus) return { protocol: 2, accountGen: generation, door: null, status: "ready", syncedAt: now / 1000 };
  const token = await requireBetterAuthToken();
  assertViewer(viewer, generation);
  const response = await supabase.functions.invoke("get-event-tickets", { body: { event_id: Number(focus.id), summary: true }, headers: { Authorization: `Bearer ${token}`, "x-auth-token": token } });
  assertViewer(viewer, generation);
  if (response.error?.context?.status === 403 || response.error?.context?.status === 404 || response.error?.context?.status === 409 || response.data?.code === "forbidden" || response.data?.code === "not_found" || response.data?.code === "not_active") return { protocol: 2, accountGen: generation, door: null, status: "ready", syncedAt: Date.now() / 1000 };
  if (response.error || response.data?.ok !== true) throw new Error("Door counts unavailable. Check your phone.");
  const door = authoritativeDoor(response.data.summary);
  if (!door || door.eventId !== String(focus.id)) throw new Error("Door counts not confirmed.");
  return { protocol: 2, accountGen: generation, door, status: "ready", syncedAt: Date.now() / 1000 };
}
/** Read-only aggregate projection. Every successful poll refreshes its truthful timestamp. */
export function useWatchDoorSync(push: (envelope: WatchDoorEnvelope) => Promise<void>) {
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const generation = useWatchSessionStore((s) => s.accountGen);
  const enabled = useWatchSettingsStore((s) => s.enabled && s.door);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["watch-door", viewer, generation], queryFn: () => loadWatchDoor(viewer!, generation), enabled: !!viewer && !!generation && enabled && Platform.OS !== "web", refetchInterval: 30_000 });
  useEffect(() => { if (!viewer || !enabled) void push({ protocol: 2, accountGen: generation, door: null, status: "ready", syncedAt: Date.now() / 1000 }); }, [viewer, enabled, generation, push]);
  useEffect(() => { if (query.data && enabled && query.data.accountGen === generation) void push(query.data); }, [query.data, enabled, generation, push]);
  useEffect(() => { if (query.error && viewer && enabled) void push({ protocol: 2, accountGen: generation, door: null, status: "error", error: "Couldn’t refresh door counts. Check your phone.", syncedAt: Date.now() / 1000 }); }, [query.error, viewer, enabled, generation, push]);
  const refresh = useCallback(async () => { await client.invalidateQueries({ queryKey: ["watch-door"] }); }, [client]);
  return { refresh, envelope: query.data };
}
