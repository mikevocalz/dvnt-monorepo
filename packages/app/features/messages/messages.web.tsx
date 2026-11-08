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

import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { MessageFilterTabs } from "./message-filter-tabs.web";
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
  RefreshCw,
  Lock,
  Globe,
  Video,
  Headphones,
  ArrowUpRight,
} from "lucide-react";
import { Dialog } from "@dvnt/ui";
import { useMessagesSheetsStore } from "@dvnt/app/lib/stores/messages-sheets-store";
import { NewMessageScreen } from "./new-message.web";
import { NewGroupScreen } from "./new-group.web";
import { useLynkDiscovery, discoveryRoomState, type LynkRecord } from "@dvnt/app/features/sneaky-lynk";

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
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
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
  user: {
    id: string;
    authId?: string;
    name: string;
    username: string;
    avatar: string;
  };
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
  const { rooms, isLoading, isFetching, isError, refetch } = useLynkDiscovery();
  const showToast = useUIStore((s) => s.showToast);

  const search = useMessagesTabStore((s) => s.search);
  const query = search.trim().toLowerCase();
  const visibleRooms = rooms.filter((room) => !query || [room.title, room.topic, room.host?.displayName, room.host?.username].some((value) => value?.toLowerCase().includes(query)));
  const createLynk = () => router.push("/feed/sneaky-lynk/create");

  const openRoom = (r: LynkRecord) => {
    if (!discoveryRoomState(r).actionable) {
      showToast(
        "info",
        "Room unavailable",
        "Refresh Lynks to check the current room status.",
      );
      return;
    }
    const query = new URLSearchParams({
      title: r.title || "",
      hasVideo: r.hasVideo ? "1" : "0",
    });
    router.push(`/feed/sneaky-lynk/room/${r.id}?${query.toString()}`);
  };

  const liveRooms = visibleRooms.filter((room) => discoveryRoomState(room).live);
  const waitingRooms = visibleRooms.filter((room) => { const state = discoveryRoomState(room); return !state.live && !state.ended; });
  const endedRooms = visibleRooms.filter((room) => discoveryRoomState(room).ended);
  const focusClass = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3FDCFF]";
  const roomCard = (room: LynkRecord) => {
    const { ended, live, countKnown, label, actionable, actionLabel } = discoveryRoomState(room);
    return (
      <button key={room.id} type="button" onClick={() => openRoom(room)} disabled={!actionable}
        aria-label={`${room.title}. ${actionLabel || label}. ${room.isPublic ? "Public" : "Private"}. ${countKnown ? `${room.listeners} people` : "Participant count unavailable"}.`}
        className={`group flex w-full min-w-0 flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left transition-colors enabled:hover:border-white/25 enabled:hover:bg-white/[0.07] disabled:opacity-60 ${focusClass}`}>
        <span className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${live ? "bg-[#FC253A]/15 text-[#FF8793]" : "bg-white/8 text-white/60"}`}>
            {live && <span className="h-1.5 w-1.5 rounded-full bg-[#FC253A]" />}{label}
          </span>
          <span className="flex items-center gap-1 text-white/60">{room.isPublic ? <Globe size={12} /> : <Lock size={12} />}{room.isPublic ? "Public" : "Private"}</span>
          <span className="ml-auto flex items-center gap-1 text-white/60">{room.hasVideo ? <Video size={13} /> : <Headphones size={13} />}{room.hasVideo ? "Video" : "Audio"}</span>
        </span>
        <span className="min-w-0">
          <span className="block break-words text-lg font-bold leading-6 text-white">{room.title || "Untitled Lynk"}</span>
          {!!room.topic && <span className="mt-1 block line-clamp-2 break-words text-sm leading-5 text-white/60">{room.topic}</span>}
        </span>
        <span className="mt-auto flex min-w-0 items-center gap-2.5 border-t border-white/8 pt-3">
          {room.host?.avatar ? <img src={room.host.avatar} alt="" loading="lazy" className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm font-bold text-white/70">{(room.host?.displayName || room.host?.username || "?").charAt(0).toUpperCase()}</span>}
          <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-white/85">{room.host?.displayName || room.host?.username || "Host"}</span><span className="block text-xs text-white/50">{countKnown ? `${room.listeners.toLocaleString()}${!ended && room.maxParticipants ? ` / ${room.maxParticipants}` : ""} ${ended ? "joined" : "in room"}` : ended ? "Session ended" : label}</span></span>
          {actionLabel && <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-[#3FDCFF]">{actionLabel}<ArrowUpRight size={15} /></span>}
        </span>
      </button>
    );
  };
  return (
    <section aria-label="Lynk discovery" aria-busy={isLoading} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-xl font-bold text-white"><Radio size={22} color="#FC253A" />Lynks</h2><p className="mt-1 text-sm text-white/55">Find your people. Join the conversation.</p></div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void refetch()} disabled={isFetching} aria-label="Refresh Lynks" className={`flex h-11 w-11 items-center justify-center rounded-lg bg-white/5 text-white/65 disabled:opacity-40 ${focusClass}`}><RefreshCw size={17} className={isFetching ? "motion-safe:animate-spin" : ""} /></button>
          <button type="button" onClick={createLynk} className={`flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold text-[#06070d] ${focusClass}`} style={{ backgroundImage: "linear-gradient(100deg,#3FDCFF,#8A40CF,#FF5BFC)" }}><Plus size={17} />Start a Lynk</button>
        </div>
      </div>
      {isError && <div role="alert" className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm leading-6 text-amber-100"><p>{rooms.length ? "Couldn’t refresh Lynks. Showing the last available rooms." : "Couldn’t load Lynks. Check your connection and try again."}</p><button type="button" onClick={() => void refetch()} disabled={isFetching} className={`mt-2 min-h-11 font-semibold underline underline-offset-4 disabled:opacity-50 ${focusClass}`}>{isFetching ? "Trying again…" : "Try again"}</button></div>}
      {isLoading && !rooms.length ? (
        <div role="status" aria-live="polite"><p className="mb-3 text-sm text-white/60">Finding Lynks…</p><div aria-hidden="true" className="grid gap-3 sm:grid-cols-2">{[0, 1, 2, 3].map((key) => <div key={key} className="h-44 rounded-2xl border border-white/8 bg-white/[0.04] p-4 motion-safe:animate-pulse"><div className="h-4 w-20 rounded bg-white/10" /><div className="mt-6 h-5 w-3/4 rounded bg-white/10" /><div className="mt-3 h-3 w-1/2 rounded bg-white/5" /></div>)}</div></div>
      ) : query && !visibleRooms.length ? <p role="status" className="rounded-xl border border-white/10 p-4 text-sm text-white/60">No Lynks match your search.</p> : visibleRooms.length ? (
        <>
          {liveRooms.length > 0 ? <section aria-label="Live now"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/55">Live now · {liveRooms.length}</h3><div className="grid items-stretch gap-3 sm:grid-cols-2">{liveRooms.map(roomCard)}</div></section> : !isError && <p className="rounded-xl border border-white/10 p-4 text-sm text-white/60">No live conversations right now. Start a Lynk and invite your people.</p>}
          {waitingRooms.length > 0 && <section aria-label="Your rooms & invitations"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/55">Your rooms &amp; invitations</h3><div className="grid items-stretch gap-3 sm:grid-cols-2">{waitingRooms.map(roomCard)}</div></section>}
          {endedRooms.length > 0 && <section aria-label="Recently ended"><h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/45">Recently ended</h3><div className="grid items-stretch gap-3 sm:grid-cols-2">{endedRooms.map(roomCard)}</div></section>}
        </>
      ) : !isError ? (
        <div className="flex flex-col items-center rounded-2xl border border-white/10 bg-white/[0.025] px-6 py-16 text-center"><span className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-[#FC253A]/10"><Radio size={26} color="#FC253A" /></span><h3 className="text-lg font-bold text-white">Make the first connection.</h3><p className="mt-2 max-w-xs text-sm leading-6 text-white/60">No Lynks to show yet. Start an audio or video room, public or just for your people.</p><button type="button" onClick={createLynk} className={`mt-5 min-h-11 rounded-lg bg-white/10 px-5 text-sm font-semibold text-white ${focusClass}`}>Start a Lynk</button></div>
      ) : null}
    </section>
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
  if (!avatar) return "/dvnt-email-glyph.png";
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
  currentUser,
  isDeleting,
  onChatPress,
  onProfilePress,
  onMarkAsRead,
  onDelete,
}: {
  item: ConversationItem;
  currentUser: ReturnType<typeof useAuthStore.getState>["user"];
  isDeleting: boolean;
  onChatPress: (item: ConversationItem) => void;
  onProfilePress: (username: string) => void;
  onMarkAsRead: (id: string) => void;
  onDelete: (item: ConversationItem) => void;
}) {
  const isGroup = !!item.isGroup;
  // `item.members` is the OTHER members — the API excludes the viewer, so a
  // raw count reads one short. Native already folds the viewer in for the
  // count; this mirrors it. The names list stays others-only.
  const stackMembers =
    isGroup && item.members
      ? (() => {
          const currentUserAuthId = currentUser?.authId || currentUser?.id;
          const alreadyIncludesCurrentUser = item.members.some(
            (member) =>
              (currentUserAuthId &&
                (member.authId === currentUserAuthId ||
                  member.id === currentUserAuthId)) ||
              (!!currentUser?.username &&
                member.username === currentUser.username),
          );
          if (!currentUser || alreadyIncludesCurrentUser) return item.members;
          return [
            ...item.members,
            {
              id: String(currentUser.id || currentUser.authId || "me"),
              authId: currentUser.authId || currentUser.id,
              username: currentUser.username || "you",
              avatar: currentUser.avatar || "",
            },
          ];
        })()
      : item.members || [];
  const memberCount = isGroup ? Math.max(stackMembers.length, 1) : 0;

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
      {isGroup && stackMembers.length > 1 ? (
        <GroupAvatarStack members={stackMembers} />
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

  // Composer visibility — the SAME store the native sheets use, so "which
  // composer is open" has one answer on both platforms (Zustand, never
  // useState). `resetNewMessage` on close is what makes the composer open
  // empty next time instead of showing the last search you typed.
  const newMessageOpen = useMessagesSheetsStore((s) => s.newMessageOpen);
  const setNewMessageOpen = useMessagesSheetsStore((s) => s.setNewMessageOpen);
  const newGroupOpen = useMessagesSheetsStore((s) => s.newGroupOpen);
  const setNewGroupOpen = useMessagesSheetsStore((s) => s.setNewGroupOpen);
  const resetNewMessage = useMessagesSheetsStore((s) => s.resetNewMessage);
  const closeNewMessage = useCallback(() => {
    setNewMessageOpen(false);
    resetNewMessage();
  }, [setNewMessageOpen, resetNewMessage]);
  const closeNewGroup = useCallback(
    () => setNewGroupOpen(false),
    [setNewGroupOpen],
  );
  // Picking someone navigates to the chat and unmounts the inbox; without this
  // the flag would still be true and the composer would be sitting there open
  // when you came back to the inbox.
  useEffect(() => {
    const store = useMessagesSheetsStore.getState();
    return () => {
      store.setNewMessageOpen(false);
      store.setNewGroupOpen(false);
      store.resetNewMessage();
    };
  }, []);

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
    const channel = freshChannel(channelId)
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

          // An INSERT for a conversation this member has never loaded — the
          // shape every NEW group chat takes for everyone but its creator.
          // Patching maps over what is cached, so the conv simply never
          // appeared until a full refetch; check membership first and let the
          // query refetch bring the unknown conversation in.
          const cached = queryClient.getQueriesData<any[]>({
            queryKey: [...messageKeys.all(viewerId), "filtered"],
          });
          const isKnown = cached.some(
            ([, data]) =>
              Array.isArray(data) &&
              data.some((c: any) => String(c.id) === convId),
          );

          if (!isKnown) {
            queryClient.invalidateQueries({
              queryKey: [...messageKeys.all(viewerId), "filtered"],
            });
            queryClient.invalidateQueries({
              queryKey: messageKeys.conversations(viewerId),
            });
          } else {
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
          }

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
        showToast(
          "error",
          "Delete failed",
          "Couldn't remove that conversation",
        );
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
            onClick={() => setNewGroupOpen(true)}
            aria-label="New group"
            title="New group"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
          >
            <Users size={18} color="#fff" />
          </button>
          <button
            type="button"
            onClick={() => setNewMessageOpen(true)}
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
            placeholder={activeTab === "lynk" ? "Search Lynks" : "Search messages"}
            aria-label={activeTab === "lynk" ? "Search Lynks" : "Search messages"}
            className="w-full bg-transparent text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
        </div>

        <MessageFilterTabs activeTab={activeTab} onChange={setActiveTab}
          inboxUnreadCount={inboxUnreadCount} spamUnreadCount={spamUnreadCount} />

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
                onClick={() => setNewMessageOpen(true)}
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
                      currentUser={currentUser}
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

      {/* ponytail: the dialog reuses the whole /messages/new page instead of a
          web-only sheet component — no drag handle, no snap points, one code
          path for both entries.
          Native opens these as bottom sheets; on web the same two composers open
          in the kit Dialog — the inbox stays behind them, so starting a message
          is never a page you have to come back from. Same store drives both. */}
      <Dialog
        open={newMessageOpen}
        onClose={closeNewMessage}
        maxWidth={640}
        hideClose
      >
        <NewMessageScreen onClose={closeNewMessage} />
      </Dialog>
      <Dialog open={newGroupOpen} onClose={closeNewGroup} maxWidth={640} hideClose>
        <NewGroupScreen onClose={closeNewGroup} />
      </Dialog>
    </div>
  );
}

export default MessagesScreen;
