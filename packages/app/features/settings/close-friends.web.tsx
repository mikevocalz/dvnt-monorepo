"use client";

import { useRef } from "react";
import { useRouter } from "solito/navigation";
import { X, Star, Users, UserPlus } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  useCloseFriendsList,
  useToggleCloseFriend,
} from "@dvnt/app/lib/hooks/use-close-friends";

/**
 * Close Friends settings — web (Phase 1 port of native
 * `app/settings/close-friends.tsx`). Law 1: faithful to the native data flow —
 * the list comes from `useCloseFriendsList` and every remove calls
 * `useToggleCloseFriend().mutate({ friendId, isCloseFriend: true })` exactly
 * like native (optimistic update + rollback live inside the mutation hook).
 * Law 2: lists on web = TanStack Virtual (`useVirtualizer`), never FlatList.
 * Law 3: raw semantic HTML + Tailwind (NativeWind interop off), sticky header
 * with a close X like legal-page.web.tsx. Avatars are rounded squares
 * (rounded-xl), never circles. Accent matches native close-friends red #FC253A.
 */

const CF_ACCENT = "#FC253A";
const ROW_HEIGHT = 72; // avatar (48) + py-3 (12*2) padding

export function CloseFriendsScreen() {
  const router = useRouter();
  const { data: closeFriends = [], isLoading } = useCloseFriendsList();
  const toggleMutation = useToggleCloseFriend();

  const handleRemove = (friendId: number) => {
    // Mirror native: already a close friend → remove (toggle off).
    toggleMutation.mutate({ friendId, isCloseFriend: true });
  };

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: closeFriends.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT + 12, // row + mb-3 gap
    overscan: 8,
  });

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Close Friends</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-6">
        {/* Info banner */}
        <div
          className="mb-4 flex items-center gap-3 rounded-xl p-4"
          style={{ backgroundColor: "rgba(252, 37, 58, 0.1)" }}
        >
          <Star size={24} color={CF_ACCENT} fill={CF_ACCENT} />
          <div className="flex-1">
            <p className="font-semibold text-white">Close Friends</p>
            <p className="text-sm text-white/60">
              Share stories exclusively with your close friends
            </p>
          </div>
        </div>

        {/* Manage CTA */}
        <button
          onClick={() => router.push("/feed/close-friends")}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-semibold text-white active:scale-[0.99]"
          style={{ backgroundColor: CF_ACCENT }}
        >
          <UserPlus size={18} color="#fff" />
          Manage Close Friends
        </button>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <span
              className="block h-8 w-8 animate-spin rounded-full border-2 border-white/20"
              style={{ borderTopColor: CF_ACCENT }}
            />
          </div>
        ) : closeFriends.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-20 text-center">
            <span className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/5">
              <Users size={48} color="#666" />
            </span>
            <p className="mb-2 text-lg font-semibold text-white">
              No Close Friends Yet
            </p>
            <p className="text-sm text-white/60">
              Tap &quot;Manage Close Friends&quot; to search and add people to
              your close friends list.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
              {closeFriends.length} CLOSE{" "}
              {closeFriends.length === 1 ? "FRIEND" : "FRIENDS"}
            </p>

            {/* TanStack Virtual list */}
            <div
              ref={parentRef}
              className="overflow-y-auto"
              style={{ maxHeight: "60dvh" }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const friend = closeFriends[item.index];
                  if (!friend) return null;
                  return (
                    <div
                      key={friend.id}
                      data-index={item.index}
                      className="absolute left-0 w-full"
                      style={{
                        top: 0,
                        height: item.size,
                        transform: `translateY(${item.start}px)`,
                        paddingBottom: 12,
                      }}
                    >
                      <div
                        onClick={() =>
                          router.push(`/feed/${friend.username}`)
                        }
                        role="button"
                        className="flex h-[72px] cursor-pointer items-center rounded-xl border border-white/10 bg-white/4 p-3 active:bg-white/8"
                      >
                        {/* Avatar — rounded square, never a circle */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={friend.avatar || ""}
                          alt={friend.name}
                          className="h-12 w-12 rounded-xl object-cover bg-white/10"
                        />
                        <div className="ml-3 min-w-0 flex-1">
                          <p className="truncate font-semibold text-white">
                            {friend.name}
                          </p>
                          <p className="truncate text-sm text-white/60">
                            @{friend.username}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemove(friend.id);
                          }}
                          aria-label={`Remove ${friend.username} from close friends`}
                          className="ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-full active:scale-95"
                          style={{ backgroundColor: "rgba(252, 37, 58, 0.15)" }}
                        >
                          <Star size={18} color={CF_ACCENT} fill={CF_ACCENT} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <p className="mt-6 text-center text-sm text-white/60">
          People won&apos;t be notified when you add or remove them from your
          close friends list.
        </p>
      </main>
    </div>
  );
}

export default CloseFriendsScreen;
