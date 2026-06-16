"use client";

/**
 * New Group screen — WEB variant (port of native
 * `app/(protected)/messages/new-group.tsx`).
 *
 * DATA WIRING IS SACRED — same API surface the native screen calls:
 *   - `usersApi.searchUsers(query, 50)`  (user search, via @tanstack/react-query)
 *   - `messagesApi.createGroupConversation(ids, name)` (create-group mutation)
 *   - `useAuthStore` (current user → filter self out of results)
 *   - `useUIStore.showToast` (validation + success/error toasts)
 * State lives in a tiny Zustand store (`useNewGroupStore`) — search query,
 * group name, and selected members — never useState (Law: state = Zustand).
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * <View>/<Text>. The participant list is virtualized with TanStack Virtual
 * (never FlatList/FlashList). Avatars are rounded squares (rounded-xl/rounded-lg).
 * Selected members render as removable rounded chips with an avatar. The group
 * name uses the kit `FormField`. Header is sticky "New Group" + Create action.
 * Routing via Solito; on create → /feed/chat/{newId}.
 */

import { useMemo, useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Debouncer } from "@tanstack/pacer";
import { ArrowLeft, Search, X, Check, Users } from "lucide-react";
import { FormField } from "@dvnt/ui";
import { usersApi } from "@dvnt/app/lib/api/users";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import {
  useNewGroupStore,
  type NewGroupSelectedUser,
} from "@dvnt/app/lib/stores/new-group-store";

const CYAN = "#3FDCFF";
const MAX_GROUP_MEMBERS = 4;
const USER_ROW_HEIGHT = 70;

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) return "https://i.pravatar.cc/150?img=0";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

// ── Virtualized participant rows (TanStack Virtual) ──────────────────
function UserRows({
  users,
  isSelected,
  onToggle,
}: {
  users: NewGroupSelectedUser[];
  isSelected: (id: string) => boolean;
  onToggle: (user: NewGroupSelectedUser) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => USER_ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className="w-full overflow-y-auto"
      style={{ maxHeight: "calc(100dvh - 320px)" }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const user = users[item.index];
          if (!user) return null;
          const selected = isSelected(user.id);
          return (
            <div
              key={user.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${item.start}px)`,
              }}
            >
              <button
                type="button"
                onClick={() => onToggle(user)}
                className="flex w-full items-center gap-3 px-1 py-3 text-left active:bg-white/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getAvatarUrl(user.avatar)}
                  alt={user.username}
                  className="h-[50px] w-[50px] shrink-0 rounded-xl object-cover bg-white/10"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-white">
                    {user.username}
                  </p>
                  <p className="truncate text-sm text-white/60">{user.name}</p>
                </div>
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected
                      ? "border-cyan-400 bg-cyan-400"
                      : "border-white/40"
                  }`}
                  style={selected ? { borderColor: CYAN, backgroundColor: CYAN } : undefined}
                >
                  {selected ? <Check size={14} color="#06070d" /> : null}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NewGroupScreen() {
  const router = useRouter();
  const currentUser = useAuthStore((s) => s.user);
  const showToast = useUIStore((s) => s.showToast);

  const searchQuery = useNewGroupStore((s) => s.searchQuery);
  const setSearchQuery = useNewGroupStore((s) => s.setSearchQuery);
  const groupName = useNewGroupStore((s) => s.groupName);
  const setGroupName = useNewGroupStore((s) => s.setGroupName);
  const selectedUsers = useNewGroupStore((s) => s.selectedUsers);
  const toggleUser = useNewGroupStore((s) => s.toggleUser);
  const removeUser = useNewGroupStore((s) => s.removeUser);
  const isSelected = useNewGroupStore((s) => s.isSelected);

  // Debounce the query the same shape search.web.tsx does (300ms).
  const debouncer = useMemo(
    () => new Debouncer((text: string) => setSearchQuery(text), { wait: 300 }),
    [setSearchQuery],
  );

  // SACRED — identical user-search call the native screen uses.
  const { data: allUsersData, isLoading } = useQuery({
    queryKey: ["users", "all", searchQuery],
    queryFn: async () => {
      try {
        const result = await usersApi.searchUsers(searchQuery || "", 50);
        return result.docs.filter((u: any) => u.id !== currentUser?.id);
      } catch (error) {
        console.error("[NewGroup] Error fetching users:", error);
        return [];
      }
    },
  });

  const filteredUsers: NewGroupSelectedUser[] = useMemo(
    () =>
      (allUsersData || [])
        .filter((u: any) => u.id !== currentUser?.id)
        .map((u: any) => ({
          id: String(u.id || ""),
          username: (u.username as string) || "unknown",
          name: (u.name as string) || (u.username as string) || "User",
          avatar: (u.avatar as string) || "",
        })),
    [allUsersData, currentUser?.id],
  );

  const handleToggle = (user: NewGroupSelectedUser) => {
    const ok = toggleUser(user, MAX_GROUP_MEMBERS);
    if (!ok) {
      showToast(
        "warning",
        "Limit Reached",
        `Group chats can have max ${MAX_GROUP_MEMBERS} members`,
      );
    }
  };

  // SACRED — identical create-group call the native screen uses.
  const createGroup = useMutation({
    mutationFn: () =>
      messagesApi.createGroupConversation(
        selectedUsers.map((u) => u.id),
        groupName.trim(),
      ),
    onSuccess: (conversation) => {
      showToast("success", "Success", "Group chat created");
      router.replace(`/feed/chat/${conversation.id}`);
    },
    onError: (error: any) => {
      console.error("[NewGroup] Error creating group:", error);
      showToast("error", "Error", error?.message || "Failed to create group");
    },
  });

  const handleCreateGroup = () => {
    if (selectedUsers.length < 2) {
      showToast("error", "Error", "Select at least 2 users for a group chat");
      return;
    }
    if (!groupName.trim()) {
      showToast("error", "Error", "Please enter a group name");
      return;
    }
    createGroup.mutate();
  };

  const canCreate = selectedUsers.length >= 2;

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="shrink-0 active:scale-95"
        >
          <ArrowLeft size={24} color="#fff" />
        </button>
        <h1 className="flex-1 text-lg font-bold text-white">New Group</h1>
        {canCreate ? (
          <button
            onClick={handleCreateGroup}
            disabled={createGroup.isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold text-[#06070d] disabled:opacity-60"
            style={{ backgroundColor: CYAN }}
          >
            {createGroup.isPending ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#06070d]/30 border-t-[#06070d] align-middle" />
            ) : (
              "Create"
            )}
          </button>
        ) : null}
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 pb-8">
        {/* Group name */}
        <div className="border-b border-white/8 py-4">
          <FormField label="Group name" htmlFor="ng-name">
            <div className="flex items-center gap-2 rounded-xl bg-white/8 px-3 focus-within:ring-2 focus-within:ring-cyan-400">
              <Users size={20} color="#999" />
              <input
                id="ng-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name..."
                maxLength={50}
                className="h-11 flex-1 bg-transparent text-base text-white placeholder-white/40 outline-none"
              />
            </div>
          </FormField>
          <p className="mt-2 text-xs text-white/40">
            Group chats support up to {MAX_GROUP_MEMBERS} members
          </p>
        </div>

        {/* Selected members — removable rounded chips */}
        {selectedUsers.length > 0 ? (
          <div className="border-b border-white/8 py-4">
            <div className="flex gap-3 overflow-x-auto pb-1 no-scrollbar">
              {selectedUsers.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => removeUser(user.id)}
                  className="flex shrink-0 items-center gap-2 rounded-full bg-white/8 py-1 pl-1 pr-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getAvatarUrl(user.avatar)}
                    alt={user.username}
                    className="h-7 w-7 rounded-lg object-cover bg-white/10"
                  />
                  <span className="text-sm font-medium text-white">
                    {user.username}
                  </span>
                  <X size={14} color="#999" />
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/40">
              {selectedUsers.length}/{MAX_GROUP_MEMBERS - 1} selected (min 2, max{" "}
              {MAX_GROUP_MEMBERS - 1})
            </p>
          </div>
        ) : null}

        {/* Search */}
        <div className="border-b border-white/8 py-4">
          <div className="flex items-center gap-2 rounded-xl bg-white/8 px-3 focus-within:ring-2 focus-within:ring-cyan-400">
            <Search size={20} color="#999" />
            <input
              defaultValue={searchQuery}
              onChange={(e) => debouncer.maybeExecute(e.target.value)}
              placeholder="Search users..."
              className="h-11 flex-1 bg-transparent text-base text-white placeholder-white/40 outline-none"
            />
            {searchQuery.length > 0 ? (
              <button
                onClick={() => {
                  debouncer.cancel();
                  setSearchQuery("");
                }}
                aria-label="Clear"
              >
                <X size={20} color="#999" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Participant list */}
        <p className="px-1 pb-2 pt-4 text-sm font-semibold text-white/60">
          Select Participants
        </p>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-white/60">
              {searchQuery ? "No users found" : "No users available"}
            </p>
          </div>
        ) : (
          <UserRows
            users={filteredUsers}
            isSelected={isSelected}
            onToggle={handleToggle}
          />
        )}
      </main>
    </div>
  );
}

export default NewGroupScreen;
