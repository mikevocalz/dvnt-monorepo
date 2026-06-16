"use client";

/**
 * Blocked Accounts settings — web (port of native `app/settings/blocked.tsx`).
 * Law 1: faithful to the native data flow — the list comes from
 * `useBlockedUsers`, unblock calls `useUnblockUser().mutate(blockId)` exactly
 * like native (the optimistic remove / rollback / toast lives inside the hook).
 * The "is this row unblocking" check mirrors native:
 * `mutation.isPending && mutation.variables === user.blockId`.
 * Law 3: raw semantic HTML + Tailwind only (NativeWind interop is off), sticky
 * header + close X like legal-page.web.tsx, rounded cards. Avatars are rounded
 * squares (never circles). List = TanStack Virtual over a scroll container
 * (project rule — never FlatList/FlashList). Empty + loading states mirror native.
 */

import { useRef } from "react";
import { useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import { X, UserX } from "lucide-react";
import {
  useBlockedUsers,
  useUnblockUser,
  type BlockedUser,
} from "@dvnt/app/lib/hooks/use-blocks";

// CDN URL with production fallback (mirrors native getAvatarUrl).
const CDN_URL =
  process.env.NEXT_PUBLIC_BUNNY_CDN_URL ||
  process.env.EXPO_PUBLIC_BUNNY_CDN_URL ||
  "https://dvnt.b-cdn.net";

function getAvatarUrl(avatar: string | null): string {
  if (!avatar) return "https://i.pravatar.cc/150?img=0";
  if (avatar.startsWith("http")) return avatar;
  return `${CDN_URL}/${avatar}`;
}

const ROW_HEIGHT = 84; // 72px row + 12px gap

function BlockedUserRow({
  user,
  onUnblock,
  isUnblocking,
}: {
  user: BlockedUser;
  onUnblock: () => void;
  isUnblocking: boolean;
}) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/user/${user.username}`)}
      role="button"
      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/4 p-3 cursor-pointer active:bg-white/6"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={getAvatarUrl(user.avatar)}
        alt={user.username}
        className="h-12 w-12 shrink-0 rounded-xl object-cover bg-white/10"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-white">{user.name}</p>
        <p className="truncate text-sm text-white/60">@{user.username}</p>
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onUnblock();
        }}
        disabled={isUnblocking}
        className="shrink-0 rounded-lg bg-white/8 px-4 py-2 font-semibold text-white transition-colors active:bg-white/12 disabled:opacity-50"
      >
        {isUnblocking ? (
          <span className="inline-block h-5 w-5 rounded-full border-2 border-white/30 border-t-white animate-spin align-middle" />
        ) : (
          "Unblock"
        )}
      </button>
    </div>
  );
}

export function BlockedScreen() {
  const router = useRouter();
  const { data: blockedUsers, isLoading } = useBlockedUsers();
  const unblockMutation = useUnblockUser();

  const handleUnblock = (blockId: string) => {
    unblockMutation.mutate(blockId);
  };

  const users = blockedUsers ?? [];

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
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
        <h1 className="text-[17px] font-semibold">Blocked</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="w-9 h-9 rounded-xl bg-white/8 flex items-center justify-center active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-cyan-500 animate-spin" />
          <p className="mt-4 text-sm text-white/60">
            Loading blocked accounts...
          </p>
        </div>
      ) : users.length === 0 ? (
        <main className="mx-auto w-full max-w-xl px-8 py-24">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-white/6">
              <UserX size={48} color="#666" />
            </div>
            <p className="mb-2 text-lg font-semibold text-white">
              No Blocked Accounts
            </p>
            <p className="text-sm text-white/60">
              When you block someone, they won&apos;t be able to find your
              profile, posts, or stories.
            </p>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-xl px-4 py-6">
          <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
            {users.length} BLOCKED{" "}
            {users.length === 1 ? "ACCOUNT" : "ACCOUNTS"}
          </p>
          <div
            ref={parentRef}
            className="overflow-y-auto"
            style={{ maxHeight: "calc(100dvh - 180px)" }}
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
                    key={user.blockId}
                    data-index={item.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${item.start}px)`,
                      paddingBottom: 12,
                    }}
                  >
                    <BlockedUserRow
                      user={user}
                      onUnblock={() => handleUnblock(user.blockId)}
                      isUnblocking={
                        unblockMutation.isPending &&
                        unblockMutation.variables === user.blockId
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

export default BlockedScreen;
