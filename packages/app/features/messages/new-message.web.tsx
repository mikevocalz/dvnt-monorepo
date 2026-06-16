"use client";

/**
 * New Message screen — WEB variant (port of native
 * `app/(protected)/messages/new.tsx`).
 *
 * DATA WIRING IS SACRED — same hooks/store/mutations the native screen uses:
 *   - `useNewMessageStore`        (zustand: searchQuery / setSearchQuery)
 *   - `useSearchUsers`            (query batch: user search via searchApi)
 *   - `usersApi.searchUsers`      (empty-query "All Users" batch, via useQuery)
 *   - `useAuthStore`              (current user — filtered out of results)
 *   - `useUIStore.showToast`      (failure toasts)
 *   - `getOrCreateConversationCached` (resolve/create the conversation, cached)
 *   - `screenPrefetch.profile`    (avatar/username tap → prefetch profile)
 * Selecting a user resolves the conversation BEFORE navigating, exactly like
 * native, then routes to the chat. Search query lives in zustand (never useState);
 * only the in-flight "creating" flag is local UI state.
 *
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop off). No
 * <View>/<Text>. List = TanStack Virtual (never FlatList/FlashList). Avatars
 * are rounded squares (rounded-xl). Routing via Solito:
 *   select user → /feed/chat/{conversationId}, avatar/username → /profile/{username}.
 */

import { useCallback, useRef, useState } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, X } from "lucide-react";
import { useNewMessageStore } from "@dvnt/app/lib/stores/comments-store";
import { useSearchUsers } from "@dvnt/app/lib/hooks/use-search";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { getOrCreateConversationCached } from "@dvnt/app/lib/hooks/use-conversation-resolution";
import { screenPrefetch } from "@dvnt/app/lib/prefetch";

const CYAN = "#3FDCFF";

const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) return "https://i.pravatar.cc/150?img=0";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

type UserRow = {
  id: string;
  username: string;
  name: string;
  avatar: string;
};

const ROW_HEIGHT = 74; // 50px avatar row + vertical padding

function UserRows({
  users,
  onSelect,
  onProfile,
  isCreating,
}: {
  users: UserRow[];
  onSelect: (username: string) => void;
  onProfile: (username: string) => void;
  isCreating: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className="w-full overflow-y-auto"
      style={{ maxHeight: "calc(100dvh - 220px)" }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const user = users[item.index];
          if (!user) return null;
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
              <div className="flex items-center gap-3 px-1 py-3">
                <button
                  type="button"
                  onClick={() => onProfile(user.username)}
                  aria-label={`Open @${user.username} profile`}
                  className="shrink-0 active:scale-95"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getAvatarUrl(user.avatar)}
                    alt={user.username}
                    className="h-[50px] w-[50px] rounded-xl object-cover bg-white/10"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => onProfile(user.username)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate font-semibold text-white">
                    {user.username}
                  </p>
                  <p className="truncate text-sm text-white/60">{user.name}</p>
                </button>
                <button
                  type="button"
                  onClick={() => onSelect(user.username)}
                  disabled={isCreating}
                  className="shrink-0 rounded-full px-4 py-2 text-sm font-semibold text-black transition-opacity active:scale-95 disabled:opacity-50"
                  style={{ backgroundColor: CYAN }}
                >
                  Message
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NewMessageScreen() {
  const router = useRouter();

  // SACRED STORE — never useState for the query.
  const searchQuery = useNewMessageStore((s) => s.searchQuery);
  const setSearchQuery = useNewMessageStore((s) => s.setSearchQuery);

  const currentUser = useAuthStore((state) => state.user);
  const showToast = useUIStore((s) => s.showToast);
  const queryClient = useQueryClient();

  const [isCreatingConversation, setIsCreatingConversation] = useState(false);

  // SACRED QUERY — "All Users" batch when no search query (mirrors native).
  const { data: allUsersData, isLoading: isLoadingAll } = useQuery({
    queryKey: ["users", "all"],
    queryFn: async () => {
      try {
        const result = await usersApi.searchUsers("", 50);
        return result.docs.filter((user: any) => user.id !== currentUser?.id);
      } catch (error) {
        console.error("[NewMessage] Error fetching users:", error);
        return [];
      }
    },
    enabled: !searchQuery || searchQuery.length === 0,
  });

  // SACRED QUERY — user search when there's a query.
  const { data: searchUsersData, isLoading: isLoadingSearch } =
    useSearchUsers(searchQuery || "");

  const isLoading = searchQuery ? isLoadingSearch : isLoadingAll;
  const allUsers = searchQuery
    ? searchUsersData?.docs || []
    : allUsersData || [];

  const filteredUsers: UserRow[] = allUsers
    .filter((user: any) => user.id !== currentUser?.id)
    .map((user: any) => ({
      id: String(user.id || ""),
      username: (user.username as string) || "unknown",
      name: (user.name as string) || (user.username as string) || "User",
      avatar: (user.avatar as string) || "",
    }));

  // Resolve/create the conversation BEFORE navigating to chat (native parity).
  const handleSelectUser = useCallback(
    async (username: string) => {
      if (isCreatingConversation) return;

      setIsCreatingConversation(true);
      try {
        // CRITICAL: pass username, not numeric user.id (cached resolution).
        const conversationId = await getOrCreateConversationCached(
          queryClient,
          username,
        );

        if (conversationId) {
          router.replace(`/feed/chat/${conversationId}`);
        } else {
          showToast("error", "Error", "Could not start conversation");
        }
      } catch (error) {
        console.error("[NewMessage] Error creating conversation:", error);
        showToast("error", "Error", "Failed to start conversation");
      } finally {
        setIsCreatingConversation(false);
      }
    },
    [router, isCreatingConversation, showToast, queryClient],
  );

  const handleProfilePress = useCallback(
    (username: string) => {
      screenPrefetch.profile(queryClient, username);
      router.push(`/profile/${username}`);
    },
    [router, queryClient],
  );

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="shrink-0 active:scale-95"
        >
          <ArrowLeft size={24} color="#fff" />
        </button>
        <h1 className="text-lg font-bold text-white">New Message</h1>
      </div>

      <main className="mx-auto w-full max-w-2xl px-4 py-4">
        {/* Search input */}
        <div className="flex items-center gap-2 rounded-xl bg-white/8 px-3 focus-within:ring-2 focus-within:ring-cyan-400">
          <Search size={20} color="#999" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users..."
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="h-11 flex-1 bg-transparent text-base text-white placeholder-white/50 outline-none"
          />
          {searchQuery.length > 0 ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear"
            >
              <X size={20} color="#999" />
            </button>
          ) : null}
        </div>

        <p className="px-1 pb-2 pt-4 text-sm font-semibold text-white/60">
          {searchQuery ? "Search Results" : "All Users"}
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
            onSelect={handleSelectUser}
            onProfile={handleProfilePress}
            isCreating={isCreatingConversation}
          />
        )}
      </main>
    </div>
  );
}

export default NewMessageScreen;
