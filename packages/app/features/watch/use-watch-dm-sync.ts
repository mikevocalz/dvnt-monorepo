/**
 * PLATFORM BEHAVIOR: iOS requests bounded thread pages and authoritative send
 * results through WCSession. The phone owns authorization and backend writes.
 * STOP-THE-LINE: account changes invalidate pending responses; transport receipt
 * never becomes send success. Background JS delivery still needs device proof.
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { messageKeys } from "@dvnt/app/lib/messages/query-keys";
import { buildDMEnvelope, dmSignature, type WatchDMEnvelope } from "./watch-dm-payload";
import { registerWatchDMReplyHandler, registerWatchRequestHandler, registerWatchThreadHandler, registerWatchThreadActionHandler, pushWatchThreadPage, clearWatchAccount, syncDMsToWatch } from "./watch-bridge";
import { useWatchSessionStore } from "./watch-session-store";
import { useWatchSettingsStore } from "./watch-settings-store";
import { watchAttachments } from "./watch-media";
import { bindMessageChanges, freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";

export function useWatchDMSync(): void {
  const viewerId = useAuthStore((s) => s.user?.id ?? null);
  const enabled = useWatchSettingsStore((s) => s.enabled && s.messages);
  const quickReplies = useWatchSettingsStore((s) => s.quickReplies);
  const queryClient = useQueryClient();
  const activeThreads = useRef(new Map<string, number>());
  const retainedMessages = useRef(new Map<string, string[]>());
  const lastSig = useRef<string | null>(null);
  const lastEnv = useRef<WatchDMEnvelope | null>(null);
  const queryKey = ["watch-conversations", viewerId];
  const { data, error } = useQuery({ queryKey, queryFn: () => messagesApi.getConversations({ throwOnError: true }),
    enabled: Platform.OS !== "web" && enabled && !!viewerId, refetchInterval: 15000 });

  useEffect(() => {
    const previousViewer = useWatchSessionStore.getState().viewerId;
    const generation = useWatchSessionStore.getState().selectAccount(viewerId);
    if (previousViewer !== viewerId) void clearWatchAccount(generation);
    lastEnv.current = null;
    lastSig.current = null;
    activeThreads.current.clear();
    retainedMessages.current.clear();
    return useAuthStore.subscribe((state, previous) => {
      if (state.user?.id === previous.user?.id) return;
      const accountGen = useWatchSessionStore.getState().selectAccount(state.user?.id ?? null);
      lastEnv.current = null;
      lastSig.current = null;
      void clearWatchAccount(accountGen);
    });
  }, [viewerId]);

  useEffect(() => registerWatchRequestHandler({ dms: () => lastEnv.current }), []);

  useEffect(() => registerWatchDMReplyHandler(
    () => lastEnv.current?.dms.map((d) => d.id) ?? [],
    async ({ conversationId, text, operationId, accountGen }) => {
      if (accountGen !== useWatchSessionStore.getState().accountGen) throw new Error("Account changed");
      const message = await messagesApi.sendMessage({ conversationId, content: text, operationId, expectedViewerId: viewerId ?? undefined });
      if (!message?.id) throw new Error("No authoritative message id");
      void queryClient.invalidateQueries({ queryKey: ["watch-conversations", viewerId] });
      void queryClient.invalidateQueries({ queryKey: messageKeys.conversations(viewerId ?? undefined) });
      return String(message.id);
    },
  ), [queryClient, viewerId]);

  const loadThread = async (conversationId: string, olderCursor?: { createdAt: string; id: string }, retainedMessageIds?: string[]) => {
    const accountGen = useWatchSessionStore.getState().accountGen;
    // Recheck the current authorized list, including bilateral blocks, per request.
    const conversations = await messagesApi.getConversations({ throwOnError: true });
    if (!conversations.some((c) => String(c.id) === conversationId)) throw new Error("Unavailable");
    const page = await messagesApi.getThreadPage(conversationId, { olderCursor, limit: 25 });
    const retained = retainedMessageIds ?? retainedMessages.current.get(conversationId) ?? [];
    let removedMessageIds: string[] = [];
    if (retained.length) {
      const { data: existing, error } = await supabase.from("messages").select("id")
        .eq("conversation_id", conversationId).in("id", retained);
      if (error) throw error;
      const available = new Set((existing ?? []).map((row) => String(row.id)));
      removedMessageIds = retained.filter((id) => !available.has(id));
    }
    if (accountGen !== useWatchSessionStore.getState().accountGen) throw new Error("Account changed");
    retainedMessages.current.set(conversationId, Array.from(new Set([
      ...retained.filter((id) => !removedMessageIds.includes(id)), ...page.messages.map((m) => m.id),
    ])).slice(-250));
    return { protocol: 2 as const, accountGen, conversationId, olderCursor: page.olderCursor, removedMessageIds,
      messages: page.messages.map((m) => ({ id: m.id, conversationId, senderId: m.senderId,
        senderName: conversations.find((c) => String(c.id) === conversationId)?.members?.find((member) => member.id === m.senderId)?.username,
        outgoing: m.sender === "user", text: m.text ?? "", createdAt: m.createdAt,
        attachments: watchAttachments(m.id, m.metadata),
        reactions: projectReactions(m.metadata, String(getCurrentUserIdSync() ?? "")) })),
    };
  };
  useEffect(() => registerWatchThreadHandler((id, cursor, retained) => {
    activeThreads.current.set(id, Date.now());
    return loadThread(id, cursor, retained);
  }), [viewerId]);

  useEffect(() => registerWatchThreadActionHandler(async (command) => {
    if (!viewerId || useAuthStore.getState().user?.id !== viewerId) throw new Error("Account changed");
    const conversations = await messagesApi.getConversations({ throwOnError: true });
    if (!conversations.some((c) => String(c.id) === command.conversationId)) throw new Error("Unavailable");
    if (command.action === "read") {
      const result = await messagesApi.markAsRead(command.conversationId, viewerId);
      if (!result.ok) throw new Error("Read not confirmed");
    } else {
      const { data, error } = await supabase.from("messages").select("id").eq("id", command.messageId!).eq("conversation_id", command.conversationId).maybeSingle();
      if (error || !data) throw new Error("Unavailable");
      await messagesApi.reactToMessage(command.messageId!, command.emoji!, { desiredPresent: command.desiredPresent, expectedViewerId: viewerId });
      await pushWatchThreadPage(await loadThread(command.conversationId));
    }
    void queryClient.invalidateQueries({ queryKey: ["watch-conversations", viewerId] });
    void queryClient.invalidateQueries({ queryKey: messageKeys.conversations(viewerId) });
  }), [viewerId, queryClient]);

  useEffect(() => {
    if (!enabled || !viewerId || Platform.OS === "web") return;
    const integerId = getCurrentUserIdSync();
    if (!integerId) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const channel = bindMessageChanges(freshChannel(`watch_messages:${viewerId}`), String(integerId), () => {
      void queryClient.invalidateQueries({ queryKey: ["watch-conversations", viewerId] });
      // Coalesce message/read bursts; only recently opened threads fetch.
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
      for (const [id, openedAt] of activeThreads.current) {
        if (Date.now() - openedAt > 300000) { activeThreads.current.delete(id); retainedMessages.current.delete(id); continue; }
        void loadThread(id).then(pushWatchThreadPage).catch(() => {});
      }
      }, 300);
    }).subscribe();
    return () => { if (refreshTimer) clearTimeout(refreshTimer); void supabase.removeChannel(channel); };
  }, [enabled, viewerId, queryClient]);

  useEffect(() => {
    if (!error || !enabled || !viewerId) return;
    const accountGen = useWatchSessionStore.getState().accountGen;
    const cached = lastEnv.current?.accountGen === accountGen ? lastEnv.current : null;
    const env: WatchDMEnvelope = { ...(cached ?? { dms: [], syncedAt: 0 }), protocol: 2, accountGen,
      status: "error", error: "Couldn’t refresh messages. Open DVNT on your phone and retry." };
    lastEnv.current = env;
    lastSig.current = null;
    void syncDMsToWatch(env);
  }, [error, enabled, viewerId]);

  useEffect(() => {
    if (Platform.OS === "web" || !data || !viewerId || !enabled || error) return;
    const accountGen = useWatchSessionStore.getState().selectAccount(viewerId);
    const env: WatchDMEnvelope = { ...buildDMEnvelope(data), protocol: 2, accountGen, status: "ready", quickReplies: quickReplies.map((r) => r.trim()).filter(Boolean) };
    const sig = dmSignature(env);
    lastEnv.current = env;
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    void syncDMsToWatch(env);
  }, [data, viewerId, enabled, quickReplies, error]);
}

function projectReactions(metadata: Record<string, unknown> | null | undefined, viewerId: string) {
  const groups = new Map<string, { emoji: string; count: number; mine: boolean }>();
  const entries = metadata?.reactions;
  if (!Array.isArray(entries)) return [];
  for (const entry of entries) {
    if (!entry || typeof entry.emoji !== "string") continue;
    const group = groups.get(entry.emoji) ?? { emoji: entry.emoji, count: 0, mine: false };
    group.count++; group.mine ||= String(entry.userId) === viewerId;
    groups.set(entry.emoji, group);
  }
  return Array.from(groups.values()).slice(0, 12);
}
