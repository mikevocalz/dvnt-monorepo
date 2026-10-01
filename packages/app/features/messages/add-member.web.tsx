"use client";

/**
 * Add-member dialog for group chats — web.
 *
 * Lets a group member search users and insert one at a time. The 12-member
 * ceiling is enforced by the database trigger, so the UI only needs to reflect
 * the limit and surface the same error message as a Sonner toast.
 */

import { useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useQuery } from "@tanstack/react-query";
import { Debouncer } from "@tanstack/pacer";
import { Search, X, UserPlus } from "lucide-react";
import { usersApi } from "@dvnt/app/lib/api/users";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { DB } from "@dvnt/app/lib/supabase/db-map";
import { MAX_GROUP_CHAT_MEMBERS } from "@dvnt/app/lib/constants/group-chat";

const USER_ROW_HEIGHT = 64;
const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null | undefined): string {
  if (!avatar) return "/dvnt-email-glyph.png";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

interface UserRow {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

export function AddMemberDialog({
  conversationId,
  currentCount,
  existingIds,
  onClose,
  onAdded,
}: {
  conversationId: string;
  currentCount: number;
  existingIds: Set<string>;
  onClose: () => void;
  onAdded?: () => void;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const currentUser = useAuthStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [addingId, setAddingId] = useState<string | null>(null);
  const debouncer = useMemo(
    () => new Debouncer((text: string) => setQuery(text), { wait: 300 }),
    [],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["users", "all", query],
    queryFn: async () => usersApi.searchUsers(query || "", 50),
    enabled: true,
  });

  const users: UserRow[] = useMemo(
    () =>
      (data?.docs || [])
        .filter(
          (u: any) =>
            u.id !== currentUser?.id && !existingIds.has(String(u.id || "")),
        )
        .map((u: any) => ({
          id: String(u.id || ""),
          username: (u.username as string) || "unknown",
          name: (u.name as string) || (u.username as string) || "User",
          avatar: (u.avatar as string) || "",
        })),
    [data, currentUser?.id, existingIds],
  );

  const handleAdd = async (user: UserRow) => {
    if (currentCount >= MAX_GROUP_CHAT_MEMBERS) {
      showToast("error", "12 MAX GROUP CHAT USERS");
      return;
    }
    setAddingId(user.id);
    try {
      const { data: userRow, error: lookupError } = await supabase
        .from(DB.users.table)
        .select(DB.users.authId)
        .eq(DB.users.id, parseInt(user.id, 10))
        .single();

      if (lookupError || !userRow?.[DB.users.authId]) {
        showToast("error", "Error", "Could not add member");
        return;
      }

      const { error } = await supabase.from(DB.conversationsRels.table).insert({
        [DB.conversationsRels.parentId]: parseInt(conversationId, 10),
        [DB.conversationsRels.usersId]: userRow[DB.users.authId],
        path: "participants",
      });

      if (error) {
        if (error.message.includes("12 MAX GROUP CHAT USERS")) {
          showToast("error", "12 MAX GROUP CHAT USERS");
        } else {
          showToast("error", "Error", error.message);
        }
        return;
      }

      showToast("success", "Success", `${user.username} added to the group`);
      onAdded?.();
      onClose();
    } catch (e: any) {
      showToast("error", "Error", e?.message || "Failed to add member");
    } finally {
      setAddingId(null);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add group member"
        className="flex max-h-[80dvh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-[#14151a] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="text-base font-semibold text-white">Add member</p>
          <p className="text-xs text-white/45">
            {currentCount}/{MAX_GROUP_CHAT_MEMBERS}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/55 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2 rounded-xl bg-white/8 px-3">
            <Search size={18} color="#999" />
            <input
              defaultValue={query}
              onChange={(e) => debouncer.maybeExecute(e.target.value)}
              placeholder="Search users..."
              className="h-10 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/40"
            />
            {query.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  debouncer.cancel();
                  setQuery("");
                }}
              >
                <X size={16} color="#999" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
            </div>
          ) : users.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-white/50">
              {query ? "No users found" : "Search for a user to add"}
            </div>
          ) : (
            <VirtualUserList users={users} onAdd={handleAdd} busyId={addingId} />
          )}
        </div>
      </div>
    </div>
  );
}

function VirtualUserList({
  users,
  onAdd,
  busyId,
}: {
  users: UserRow[];
  onAdd: (user: UserRow) => void;
  busyId: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => USER_ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div ref={parentRef} className="h-full overflow-y-auto">
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const user = users[item.index];
          if (!user) return null;
          const busy = busyId === user.id;
          return (
            <div
              key={user.id}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 flex w-full items-center gap-3 px-4 py-3"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <img
                src={getAvatarUrl(user.avatar)}
                alt={user.username}
                className="h-10 w-10 rounded-xl object-cover bg-white/10"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {user.username}
                </p>
                <p className="truncate text-xs text-white/50">{user.name}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAdd(user)}
                className="flex h-8 items-center gap-1 rounded-full bg-cyan-400 px-3 text-xs font-semibold text-[#06070d] disabled:opacity-50"
              >
                {busy ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#06070d]/30 border-t-[#06070d]" />
                ) : (
                  <UserPlus size={14} />
                )}
                Add
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
