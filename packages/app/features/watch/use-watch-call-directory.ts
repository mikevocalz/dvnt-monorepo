import { useCallback, useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVideoRoomStore } from "@dvnt/app/features/video";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { mmkvStorage } from "@dvnt/app/lib/mmkv-zustand";
import { useWatchSessionStore } from "./watch-session-store";
import { useWatchSettingsStore } from "./watch-settings-store";
import { watchRendition } from "./watch-rendition";
import { validateCallDirectoryCommand, type WatchCallDirectory, type WatchCallDirectoryResult, type WatchCallPerson, type WatchCallRecent } from "./watch-call-directory";

const operations = create<{ generation: string; results: Record<string, WatchCallDirectoryResult | "pending"> }>()(persist(() => ({ generation: "", results: {} }), { name: "watch-call-directory-operations", storage: mmkvStorage }));
function assertViewer(viewer: string, generation: string) {
  if (useAuthStore.getState().user?.id !== viewer || useWatchSessionStore.getState().accountGen !== generation) throw new Error("Account changed. Sync and retry.");
}
async function currentIntegerId(viewer: string, generation: string): Promise<number> {
  assertViewer(viewer, generation);
  const column = /^[1-9][0-9]*$/.test(viewer) ? "id" : "auth_id";
  const result = await supabase.from("users").select("id").eq(column, viewer).single();
  assertViewer(viewer, generation);
  if (result.error || !result.data?.id) throw new Error("Sign in on your phone.");
  return Number(result.data.id);
}
async function blockedIds(viewer: string, generation: string) {
  assertViewer(viewer, generation);
  const id = await currentIntegerId(viewer, generation);
  if (!id) throw new Error("Sign in on your phone.");
  const rows = await supabase.from("blocks").select("blocker_id,blocked_id").or(`blocker_id.eq.${id},blocked_id.eq.${id}`);
  if (rows.error) throw rows.error;
  assertViewer(viewer, generation);
  return new Set([String(id), ...(rows.data ?? []).map((r) => String(String(r.blocker_id) === String(id) ? r.blocked_id : r.blocker_id))]);
}
async function people(viewer: string, generation: string, ids?: string[], search?: string): Promise<WatchCallPerson[]> {
  const blocked = await blockedIds(viewer, generation);
  let query = supabase.from("users").select("id,auth_id,username,first_name,avatar:avatar_id(url)").not("auth_id", "is", null);
  if (ids) query = query.in("id", ids);
  if (search) {
    const term = search.replace(/[%_,().]/g, "").trim();
    if (!term) throw new Error("Enter a username to search.");
    query = query.ilike("username", `%${term}%`);
  }
  const result = await query.order("username").limit(60);
  if (result.error) throw result.error;
  assertViewer(viewer, generation);
  return (result.data ?? []).filter((r) => !blocked.has(String(r.id)) && r.auth_id).map((r) => {
    const avatar = Array.isArray(r.avatar) ? r.avatar[0] : r.avatar;
    return { id: String(r.id), name: r.first_name || r.username || "Member", avatarURL: typeof avatar?.url === "string" && avatar.url.startsWith("https://") ? watchRendition(avatar.url, 96) : undefined };
  });
}
export interface WatchCallDirectoryTransport {
  push: (envelope: WatchCallDirectory) => Promise<void>;
  openOnPhone: (params: { participantIds: string[]; callType: "audio" | "video"; recipientUsername: string }) => Promise<boolean>;
}
export function useWatchCallDirectory({ push, openOnPhone }: WatchCallDirectoryTransport) {
  const viewer = useAuthStore((s) => s.user?.id ?? null);
  const generation = useWatchSessionStore((s) => s.accountGen);
  const enabled = useWatchSettingsStore((s) => s.enabled && s.calls);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["watch-call-directory", viewer, generation], enabled: !!viewer && !!generation && enabled && Platform.OS !== "web", refetchInterval: 60_000,
    queryFn: async (): Promise<WatchCallDirectory> => {
      assertViewer(viewer!, generation);
      const id = await currentIntegerId(viewer!, generation);
      if (!id) throw new Error("Sign in on your phone.");
      const signals = await supabase.from("call_signals").select("id,room_id,caller_id,callee_id,status,call_type,created_at").or(`caller_id.eq.${id},callee_id.eq.${id}`).order("created_at", { ascending: false }).limit(80);
      if (signals.error) throw signals.error;
      assertViewer(viewer!, generation);
      const ids = [...new Set((signals.data ?? []).flatMap((r) => [String(r.caller_id), String(r.callee_id)]).filter((x) => /^[1-9][0-9]*$/.test(x)))];
      const contacts = ids.length ? await people(viewer!, generation, ids) : [];
      const byId = new Map(contacts.map((p) => [p.id, p]));
      const rooms = new Map<string, WatchCallRecent>();
      for (const signal of signals.data ?? []) {
        const other = String(signal.caller_id) === String(id) ? String(signal.callee_id) : String(signal.caller_id);
        const person = byId.get(other);
        if (!person) continue;
        const existing = rooms.get(signal.room_id);
        if (existing) { if (!existing.people.some((p) => p.id === person.id)) existing.people.push(person); continue; }
        rooms.set(signal.room_id, { id: signal.room_id, people: [person], createdAt: signal.created_at, direction: String(signal.caller_id) === String(id) ? "outgoing" : "incoming", status: signal.status, isVideo: signal.call_type !== "audio" });
      }
      return { protocol: 2, accountGen: generation, syncedAt: Date.now() / 1000, people: contacts, recents: [...rooms.values()].slice(0, 20) };
    } });
  useEffect(() => { if (!enabled || !viewer) void push({ protocol: 2, accountGen: generation, syncedAt: Date.now() / 1000, people: [], recents: [] }); }, [enabled, viewer, generation, push]);
  useEffect(() => { if (query.data && enabled && query.data.accountGen === generation) void push(query.data); }, [query.data, enabled, generation, push]);
  useEffect(() => { if (query.error && viewer && enabled) void push({ protocol: 2, accountGen: generation, syncedAt: Date.now() / 1000, people: [], recents: [], error: "Couldn’t refresh calls. Try again with your phone nearby." }); }, [query.error, viewer, enabled, generation, push]);
  const refresh = useCallback(async () => { await client.invalidateQueries({ queryKey: ["watch-call-directory"] }); }, [client]);
  const handleCommand = useCallback(async (raw: unknown): Promise<WatchCallDirectoryResult> => {
    const command = validateCallDirectoryCommand(raw, generation);
    const operationId = raw && typeof raw === "object" && "operationId" in raw ? String(raw.operationId) : "";
    const base = { protocol: 2 as const, accountGen: generation, operationId };
    if (!command || !viewer || !enabled) return { ...base, status: "rejected", message: "Expired request. Sync and retry." };
    try {
      assertViewer(viewer, generation);
      if (command.action === "search") return { ...base, status: "confirmed", people: await people(viewer, generation, undefined, command.query) };
      if (operations.getState().generation !== generation) operations.setState({ generation, results: {} });
      const prior = operations.getState().results[operationId];
      if (prior) return prior === "pending" ? { ...base, status: "failed", message: "Check your phone before starting another call." } : prior;
      operations.setState({ results: Object.fromEntries(Object.entries({ ...operations.getState().results, [operationId]: "pending" as const }).slice(-80)) });
      const selected = await people(viewer, generation, command.participantIds);
      assertViewer(viewer, generation);
      if (selected.length !== command.participantIds!.length) throw new Error("One or more people are unavailable.");
      if (AppState.currentState !== "active") throw new Error("Open DVNT on your phone to start the call.");
      if (!["idle", "call_ended", "error"].includes(useVideoRoomStore.getState().callPhase)) throw new Error("Finish your current call first.");
      if (Date.now() / 1000 >= command.expiresAt) throw new Error("Request expired. Try again.");
      if (!await openOnPhone({ participantIds: command.participantIds!, callType: command.callType!, recipientUsername: selected.map((p) => p.name).join(", ") })) throw new Error("Open DVNT on your phone to continue.");
      assertViewer(viewer, generation);
      const result: WatchCallDirectoryResult = { ...base, status: "confirmed", message: "Continue the call on your phone" };
      operations.setState({ results: { ...operations.getState().results, [operationId]: result } });
      return result;
    } catch (error) { return { ...base, status: "failed", message: error instanceof Error ? error.message : "Couldn’t open the call on your phone." }; }
  }, [viewer, generation, enabled, openOnPhone]);
  return { handleCommand, refresh };
}
