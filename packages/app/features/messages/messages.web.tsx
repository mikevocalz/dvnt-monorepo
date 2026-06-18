"use client";

/**
 * Messages (conversations list / inbox) — WEB variant (port of native
 * `app/(protected)/messages.tsx`). MOBILE is the source of truth.
 *
 * Law 1 (data wiring is sacred): imports/calls the EXACT same hooks native uses —
 * useFilteredConversations("primary" | "requests"), useUnreadMessageCount,
 * useRefreshMessageCounts, messageKeys, useBootstrapMessages, the messagesApi
 * impl (markAsRead / deleteConversation), the auth + unread-counts + ui stores,
 * the supabase realtime channel (postgres_changes on `messages`) that patches the
 * filtered-conversations cache + invalidates unread counts on every INSERT, and
 * useUserPresence for the online dot. Primary/Requests tabs, unread counts,
 * mark-as-read, delete, and realtime are all ported.
 *
 * Law 2 (lists on web = TanStack Virtual, never FlatList/FlashList): the
 * conversation list is virtualized over a scroll container, mirroring
 * blocked.web.tsx + activity.web.tsx.
 *
 * Law 3 (NativeWind interop off): raw semantic HTML + Tailwind className only.
 * No <View>/<Text>. Avatars are rounded squares (rounded-xl), never circles.
 *
 * State (active tab + search query) lives in a tiny zustand store (never
 * useState for app state). Native swipe-to-delete becomes a row hover action.
 * bg #06070d, accent cyan #3FDCFF, unread rows highlighted.
 */

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { useRouter } from "solito/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Inbox,
  ShieldAlert,
  Users,
  Edit,
  Search,
  Trash2,
  CheckCheck,
  MessageSquare,
  Radio,
  Plus,
} from "lucide-react";
import { sneakyLynkApi } from "@dvnt/app/src/sneaky-lynk/api/supabase";
import { useQuery } from "@tanstack/react-query";

import { messagesApi as messagesApiClient } from "@dvnt/app/lib/api/messages-impl";
import {
  useUnreadMessageCount,
  useFilteredConversations,
  useRefreshMessageCounts,
  messageKeys,
} from "@dvnt/app/lib/hooks/use-messages";
import { useBootstrapMessages } from "@dvnt/app/lib/hooks/use-bootstrap-messages";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUnreadCountsStore } from "@dvnt/app/lib/stores/unread-counts-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { useUserPresence } from "@dvnt/app/lib/hooks/use-presence";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { getCurrentUserIdSync } from "@dvnt/app/lib/api/auth-helper";

// ── Conversation shape returned by messagesApi.getFilteredConversations ──────
interface ConversationMember {
  id: string;
  authId?: string;
  username: string;
  avatar: string;
}
interface Conversation {
  id: string;
  user: { id: string; authId?: string; name: string; username: string; avatar: string };
  lastMessage: string;
  timestamp: string;
  unread: boolean;
  isGroup?: boolean;
  groupName?: string;
  members?: ConversationMember[];
}

interface ConversationItem {
  id: string;
  oderpantId: string;
  user: { username: string; name: string; avatar: string };
  lastMessage: string;
  timeAgo: string;
  unread: boolean;
  isGroup?: boolean;
  groupName?: string;
  members?: ConversationMember[];
}

type TabType = "primary" | "requests" | "lynk";

// ── Sneaky Lynk tab — live rooms, mirrors the native 3rd inbox tab ────────────
// Parity with native `SneakyLynkContent`: a "Lynks" header with a + create
// button (→ /feed/sneaky-lynk/create) and a "Start a Lynk" empty-state CTA, so
// hosts can start a room from this tab (the native affordance was dropped).
function SneakyLynkTab() {
  const router = useRouter();
  const { data: rooms = [], isLoading } = useQuery({
    queryKey: ["sneaky-lynk", "rooms"],
    queryFn: () => sneakyLynkApi.getLiveRooms(),
    refetchInterval: 20000,
    staleTime: 10000,
  });
  const showToast = useUIStore((s) => s.showToast);

  const createLynk = () => router.push("/feed/sneaky-lynk/create");

  const openRoom = (r: any) => {
    if (r.isLive === false || r.status === "ended") {
      showToast("info", "Lynk Ended", "This Lynk has ended and can't be rejoined");
      return;
    }
    const query = new URLSearchParams({
      title: r.title || "",
      hasVideo: r.hasVideo ? "1" : "0",
    });
    router.push(`/feed/sneaky-lynk/room/${r.id}?${query.toString()}`);
  };

  // Header — "Lynks" + create button (shown above the list and the empty state).
  const header = (
    <div className="mb-3 flex items-center justify-between">
      <span className="flex items-center gap-2">
        <Radio size={22} color="#FC253A" />
        <span className="text-lg font-extrabold text-white">Lynks</span>
      </span>
      <button
        type="button"
        onClick={createLynk}
        aria-label="Start a Lynk"
        className="flex h-9 w-9 items-center justify-center rounded-xl text-white transition-transform active:scale-95"
        style={{ backgroundImage: "linear-gradient(120deg,#3FDCFF,#FF5BFC,#8A40CF)" }}
      >
        <Plus size={20} color="#06070d" />
      </button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col">
        {header}
        <div className="flex flex-col items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-[#3FDCFF]" />
        </div>
      </div>
    );
  }
  if (!rooms.length) {
    return (
      <div className="flex flex-col">
        {header}
        <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundImage: "linear-gradient(120deg,#3FDCFF,#FF5BFC,#8A40CF)" }}
          >
            <Radio size={28} color="#06070d" />
          </div>
          <p className="text-[17px] font-bold text-white">No Lynks Yet</p>
          <p className="mt-1 max-w-sm text-sm text-white/55">
            Start a live conversation with friends.
          </p>
          <button
            type="button"
            onClick={createLynk}
            className="mt-5 flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold text-[#06070d] transition-transform active:scale-95"
            style={{ backgroundImage: "linear-gradient(120deg,#3FDCFF,#FF5BFC,#8A40CF)" }}
          >
            <Plus size={18} color="#06070d" /> Start a Lynk
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {header}
      <div className="flex flex-col gap-2">
        {rooms.map((r: any) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openRoom(r)}
            className="group flex items-center gap-3 rounded-2xl border border-[#3FDCFF]/18 bg-white/[0.045] px-3 py-3 text-left transition-colors hover:bg-white/[0.08]"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundImage: "linear-gradient(120deg,#3FDCFF,#FF5BFC,#8A40CF)" }}
            >
              <Radio size={18} color="#06070d" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-bold text-white">
                {r.title || r.name || r.hostName || "Live room"}
              </span>
              <span className="block truncate text-xs text-white/55">
                {(r.host?.displayName || r.host?.username || r.hostName || r.host_name || "") +
                  (r.listeners != null ? ` · ${r.listeners} listening` : "")}
              </span>
            </span>
            <span className="flex items-center gap-1 rounded-full bg-[#FF5BFC]/18 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#FFC7FB]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#FF5BFC]" /> live
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Tab + search state in zustand (never useState — project rule) ────────────
interface MessagesTabState {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  search: string;
  setSearch: (q: string) => void;
  deletingId: string | null;
  setDeletingId: (id: string | null) => void;
}
const useMessagesTabStore = create<MessagesTabState>((set) => ({
  activeTab: "primary",
  setActiveTab: (activeTab) => set({ activeTab }),
  search: "",
  setSearch: (search) => set({ search }),
  deletingId: null,
  setDeletingId: (deletingId) => set({ deletingId }),
}));

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function avatarUrl(avatar?: string): string {
  if (!avatar) return "https://i.pravatar.cc/150?img=0";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

const ROW_HEIGHT = 88; // 76px row + 12px gap

// ── Online presence dot (rounded full — status indicator, not an avatar) ─────
function PresenceDot({ oderpantId }: { oderpantId: string }) {
  const { isOnline } = useUserPresence(oderpantId);
  if (!isOnline) return null;
  return (
    <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-[#06070d] bg-[#3FDCFF]" />
  );
}

// ── Group avatar stack (2×2 rounded-square tiles) ────────────────────────────
function GroupAvatarStack({ members }: { members: ConversationMember[] }) {
  const preview = members.slice(0, 4);
  const positions = [
    "top-1 left-1",
    "top-1 right-1",
    "bottom-1 left-1",
    "bottom-1 right-1",
  ] as const;
  return (
    <span className="relative block h-14 w-14 shrink-0 rounded-xl border border-white/8 bg-white/4">
      {preview.map((m, idx) => (
        <span
          key={m.id || `${m.username}-${idx}`}
          className={`absolute ${positions[idx] ?? positions[0]} h-[22px] w-[22px] overflow-hidden rounded-md`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(m.avatar)}
            alt={m.username}
            className="h-full w-full object-cover bg-white/10"
          />
        </span>
      ))}
    </span>
  );
}

function ConversationRow({
  item,
  isDeleting,
  onChatPress,
  onProfilePress,
  onMarkAsRead,
  onDelete,
}: {
  item: ConversationItem;
  isDeleting: boolean;
  onChatPress: (item: ConversationItem) => void;
  onProfilePress: (username: string) => void;
  onMarkAsRead: (id: string) => void;
  onDelete: (item: ConversationItem) => void;
}) {
  const isGroup = !!item.isGroup;
  const memberCount = isGroup
    ? Math.max(item.members?.length ?? 1, 1)
    : 0;

  return (
    <div
      onClick={() => onChatPress(item)}
      role="button"
      className={`group relative flex items-center gap-3 rounded-2xl border px-3 py-2.5 cursor-pointer transition-colors ${
        isGroup
          ? "border-[#8A40CF]/18 bg-[#8A40CF]/8"
          : item.unread
            ? "border-[#3FDCFF]/28 bg-white/[0.045]"
            : "border-white/6 bg-white/[0.03]"
      } ${isDeleting ? "opacity-60" : "active:bg-white/6"}`}
    >
      {/* Avatar */}
      {isGroup && (item.members?.length ?? 0) > 1 ? (
        <GroupAvatarStack members={item.members!} />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onProfilePress(item.user.username);
          }}
          className="relative shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(item.user.avatar)}
            alt={item.user.username}
            className="h-14 w-14 rounded-xl object-cover bg-white/10"
          />
          <PresenceDot oderpantId={item.oderpantId} />
        </button>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {isGroup ? (
                <span className="flex items-center gap-1 rounded-xl border border-[#CFA8FF]/18 bg-[#8A40CF]/18 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#E6D4FF]">
                  <Users size={11} color="#CFA8FF" />
                  Group
                </span>
              ) : null}
              <span
                onClick={(e) => {
                  if (isGroup) return;
                  e.stopPropagation();
                  onProfilePress(item.user.username);
                }}
                className={`truncate text-[17px] text-white ${
                  item.unread ? "font-extrabold" : "font-semibold"
                }`}
              >
                {isGroup
                  ? item.groupName || item.user.username
                  : item.user.username}
              </span>
            </div>
            <p className="truncate text-xs font-semibold text-white/50">
              {isGroup
                ? `${memberCount} members${
                    item.members && item.members.length > 0
                      ? ` • ${item.members.map((m) => m.username).join(", ")}`
                      : ""
                  }`
                : `${item.user.name || item.user.username} • Direct message`}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span
              className={`text-[11px] font-bold ${
                item.unread ? "text-[#8EDBFF]" : "text-white/40"
              }`}
            >
              {item.timeAgo}
            </span>
            {item.unread ? (
              <span className="rounded-xl border border-[#3FDCFF]/24 bg-[#3FDCFF]/18 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#B9EAFF]">
                New
              </span>
            ) : null}
          </div>
        </div>
        <p
          className={`mt-1 line-clamp-2 text-sm leading-5 ${
            item.unread ? "text-white" : "text-white/70"
          }`}
        >
          {item.lastMessage || "No messages yet"}
        </p>
      </div>

      {/* Hover row actions (web equivalent of native swipe) */}
      <div className="absolute right-3 top-1/2 hidden -translate-y-1/2 items-center gap-1.5 rounded-xl bg-[#06070d]/80 px-1.5 py-1 backdrop-blur group-hover:flex">
        {item.unread ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMarkAsRead(item.id);
            }}
            aria-label="Mark as read"
            title="Mark as read"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-[#3FDCFF] active:scale-95"
          >
            <CheckCheck size={16} color="#3FDCFF" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(item);
          }}
          disabled={isDeleting}
          aria-label={item.isGroup ? "Leave group" : "Delete conversation"}
          title={item.isGroup ? "Leave group" : "Delete conversation"}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#D92D20] text-white active:scale-95 disabled:opacity-60"
        >
          <Trash2 size={16} color="#fff" />
        </button>
      </div>
    </div>
  );
}

export function MessagesScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const viewerId = currentUser?.id;
  const setMessagesUnread = useUnreadCountsStore((s) => s.setMessagesUnread);
  const setSpamUnread = useUnreadCountsStore((s) => s.setSpamUnread);
  const showToast = useUIStore((s) => s.showToast);

  // Prime caches exactly like native.
  useBootstrapMessages();
  const refreshMessageCounts = useRefreshMessageCounts();

  const activeTab = useMessagesTabStore((s) => s.activeTab);
  const setActiveTab = useMessagesTabStore((s) => s.setActiveTab);
  const search = useMessagesTabStore((s) => s.search);
  const setSearch = useMessagesTabStore((s) => s.setSearch);
  const deletingId = useMessagesTabStore((s) => s.deletingId);
  const setDeletingId = useMessagesTabStore((s) => s.setDeletingId);

  // SACRED data hooks — identical to native.
  const { data: inboxUnreadCount = 0, spamCount: spamUnreadCount = 0 } =
    useUnreadMessageCount();
  const { data: inboxRaw = [], isLoading: inboxLoading } =
    useFilteredConversations("primary");
  const { data: spamRaw = [], isLoading: spamLoading } =
    useFilteredConversations("requests");

  // Realtime — new-message INSERTs patch the filtered cache + bump unread.
  useEffect(() => {
    if (!viewerId) return;
    let cancelled = false;

    const channelId = `conv-list-${viewerId}-${Date.now()}`;
    const channel = supabase
      .channel(channelId)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          if (cancelled) return;
          const newMsg = payload.new as any;
          const convId = String(newMsg.conversation_id);
          const content = newMsg.content || "";
          const currentUserIntId = getCurrentUserIdSync();
          const isMine =
            currentUserIntId != null &&
            String(newMsg.sender_id) === String(currentUserIntId);

          queryClient.setQueriesData<any[]>(
            { queryKey: [...messageKeys.all(viewerId), "filtered"] },
            (old) => {
              if (!Array.isArray(old)) return old;
              return old.map((conv: any) => {
                if (String(conv.id) !== convId) return conv;
                return {
                  ...conv,
                  lastMessage: content,
                  timestamp: "Just now",
                  unread: !isMine ? true : conv.unread,
                };
              });
            },
          );

          if (!isMine) {
            queryClient.invalidateQueries({
              queryKey: messageKeys.unreadCount(viewerId),
            });
          }
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [viewerId, queryClient]);

  // ── Transform + filter ─────────────────────────────────────────────────────
  const transform = (conv: Conversation): ConversationItem | null => {
    const otherUser = conv.user;
    if (!otherUser) return null;
    return {
      id: conv.id,
      oderpantId: otherUser.id || conv.id,
      user: {
        username:
          conv.isGroup && conv.groupName ? conv.groupName : otherUser.username,
        name:
          conv.isGroup && conv.groupName
            ? conv.groupName
            : otherUser.name || otherUser.username,
        avatar: otherUser.avatar || "",
      },
      lastMessage: conv.lastMessage || "",
      timeAgo: conv.timestamp || "",
      unread: conv.unread || false,
      isGroup: conv.isGroup,
      groupName: conv.groupName,
      members: conv.members?.map((m) => ({
        id: m.id,
        authId: m.authId,
        username: m.username,
        avatar: m.avatar,
      })),
    };
  };

  const inboxConversations = useMemo(
    () =>
      (inboxRaw as Conversation[])
        .map(transform)
        .filter((c): c is ConversationItem => c !== null),
    [inboxRaw],
  );
  const spamConversations = useMemo(
    () =>
      (spamRaw as Conversation[])
        .map(transform)
        .filter((c): c is ConversationItem => c !== null),
    [spamRaw],
  );

  const conversations =
    activeTab === "primary" ? inboxConversations : spamConversations;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const haystack = [
        c.user.username,
        c.user.name,
        c.groupName,
        c.lastMessage,
        ...(c.members?.map((m) => m.username) ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [conversations, search]);

  // ── Handlers (sacred semantics from native) ────────────────────────────────
  const handleChatPress = (item: ConversationItem) => {
    router.push(`/feed/chat/${item.id}`);
  };

  const handleProfilePress = (username: string) => {
    router.push(`/profile/${encodeURIComponent(username)}`);
  };

  const handleMarkAsRead = async (conversationId: string) => {
    try {
      const result = await messagesApiClient.markAsRead(conversationId);
      if (!result.ok) return;
      await refreshMessageCounts(conversationId, result.unread);
    } catch (err) {
      console.error("[Messages] markAsRead error:", err);
    }
  };

  const handleDelete = async (item: ConversationItem) => {
    if (!viewerId || deletingId === item.id) return;
    setDeletingId(item.id);
    try {
      const result = await messagesApiClient.deleteConversation(item.id);
      if (!result.ok) {
        showToast("error", "Delete failed", "Couldn't remove that conversation");
        return;
      }

      queryClient.setQueryData<any[]>(
        messageKeys.conversations(viewerId),
        (old) =>
          Array.isArray(old)
            ? old.filter((c) => String(c?.id) !== item.id)
            : old,
      );
      queryClient.setQueriesData<any[]>(
        { queryKey: [...messageKeys.all(viewerId), "filtered"] },
        (old) =>
          Array.isArray(old)
            ? old.filter((c) => String(c?.id) !== item.id)
            : old,
      );

      if (result.unread) {
        setMessagesUnread(result.unread.inbox);
        setSpamUnread(result.unread.spam);
        queryClient.setQueryData(messageKeys.unreadCount(viewerId), {
          inbox: result.unread.inbox,
          spam: result.unread.spam,
        });
      }

      await Promise.allSettled([
        queryClient.invalidateQueries({
          queryKey: messageKeys.conversations(viewerId),
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: [...messageKeys.all(viewerId), "filtered"],
          refetchType: "active",
        }),
        queryClient.invalidateQueries({
          queryKey: messageKeys.unreadCount(viewerId),
          refetchType: "active",
        }),
      ]);

      showToast(
        "success",
        item.isGroup ? "Left group" : "Deleted",
        item.isGroup ? "Removed from your messages" : "Conversation removed",
      );
    } catch (error) {
      console.error("[Messages] deleteConversation error:", error);
      showToast("error", "Delete failed", "Couldn't remove that conversation");
    } finally {
      setDeletingId(deletingId === item.id ? null : deletingId);
    }
  };

  // ── Virtualized list (TanStack Virtual) ────────────────────────────────────
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [activeTab, search, filtered.length, virtualizer]);

  const tabLoading = activeTab === "primary" ? inboxLoading : spamLoading;
  const isInitialLoading = tabLoading && conversations.length === 0;
  const isEmpty = !isInitialLoading && filtered.length === 0;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between gap-2 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <h1 className="text-[17px] font-semibold">Messages</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.push("/feed/messages/new-group")}
            aria-label="New group"
            title="New group"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
          >
            <Users size={18} color="#fff" />
          </button>
          <button
            type="button"
            onClick={() => router.push("/feed/messages/new")}
            aria-label="New message"
            title="New message"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#3FDCFF] active:scale-95"
          >
            <Edit size={18} color="#06070d" />
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Search */}
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-3.5 py-2.5">
          <Search size={16} color="#71717a" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search messages"
            className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>

        {/* Tabs */}
        <nav
          className="mb-4 flex gap-2 rounded-2xl border border-white/15 bg-[#18181b]/85 p-2"
          aria-label="Message filters"
        >
          <button
            type="button"
            onClick={() => setActiveTab("primary")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
              activeTab === "primary"
                ? "border-[#3FDCFF]/30 bg-[#3FDCFF]/14 text-[#3FDCFF]"
                : "border-transparent bg-transparent text-white/60"
            }`}
          >
            <Inbox
              size={16}
              color={activeTab === "primary" ? "#3FDCFF" : "#6B7280"}
            />
            Inbox
            {inboxUnreadCount > 0 ? (
              <span className="min-w-5 rounded-[10px] bg-[#3FDCFF] px-1.5 py-0.5 text-center text-[11px] font-bold text-[#06070d]">
                {inboxUnreadCount > 99 ? "99+" : inboxUnreadCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("requests")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
              activeTab === "requests"
                ? "border-white/8 bg-white/10 text-white"
                : "border-transparent bg-transparent text-white/60"
            }`}
          >
            <ShieldAlert
              size={16}
              color={activeTab === "requests" ? "#fff" : "#6B7280"}
            />
            Requests
            {spamUnreadCount > 0 ? (
              <span className="min-w-5 rounded-[10px] bg-white/14 px-1.5 py-0.5 text-center text-[11px] font-bold text-white">
                {spamUnreadCount > 99 ? "99+" : spamUnreadCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("lynk")}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-bold transition-colors ${
              activeTab === "lynk"
                ? "border-[#FF5BFC]/30 bg-[#FF5BFC]/14 text-[#FF8BFD]"
                : "border-transparent bg-transparent text-white/60"
            }`}
          >
            <Radio size={16} color={activeTab === "lynk" ? "#FF8BFD" : "#6B7280"} />
            Sneaky Lynk
          </button>
        </nav>

        {activeTab === "lynk" ? (
          <SneakyLynkTab />
        ) : isInitialLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-500" />
            <p className="mt-4 text-sm text-white/60">Loading messages...</p>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
            {activeTab === "primary" ? (
              <Inbox size={48} color="#71717a" />
            ) : (
              <ShieldAlert size={48} color="#71717a" />
            )}
            <p className="mt-4 text-lg font-semibold text-white">
              {search.trim()
                ? "No matches"
                : activeTab === "primary"
                  ? "No Messages"
                  : "No Message Requests"}
            </p>
            <p className="mt-1 text-sm text-white/60">
              {search.trim()
                ? "No conversations match your search."
                : activeTab === "primary"
                  ? "Messages from people you follow will appear here"
                  : "Messages from people you don't follow will appear here"}
            </p>
            {!search.trim() ? (
              <button
                type="button"
                onClick={() => router.push("/feed/messages/new")}
                className="mt-5 flex items-center gap-2 rounded-xl bg-[#3FDCFF] px-4 py-2.5 text-sm font-bold text-[#06070d] active:scale-95"
              >
                <MessageSquare size={16} color="#06070d" />
                Start a Conversation
              </button>
            ) : null}
          </div>
        ) : (
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 240px)" }}
          >
            <div
              className="relative w-full"
              style={{ height: virtualizer.getTotalSize() }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const item = filtered[vItem.index];
                if (!item) return null;
                return (
                  <div
                    key={item.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <ConversationRow
                      item={item}
                      isDeleting={deletingId === item.id}
                      onChatPress={handleChatPress}
                      onProfilePress={handleProfilePress}
                      onMarkAsRead={handleMarkAsRead}
                      onDelete={handleDelete}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default MessagesScreen;
