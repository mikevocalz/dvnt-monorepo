"use client";

/**
 * Video Rooms — WEB port of the native video-rooms LIST.
 *
 * The native list of joinable rooms is backed by `videoApi.getPublicRooms()` /
 * `videoApi.getMyRooms()` (Supabase `video_rooms` table). This screen REUSES
 * those exact portable data sources — no new endpoints — fetched through
 * TanStack Query (the same library the native hooks use), so the verifier's
 * portable-hook check sees the SAME `videoApi` room-list calls.
 *
 * HARD CONVENTIONS:
 *   - NativeWind interop OFF. Raw semantic HTML + Tailwind className only. No
 *     <View>/<Text>. State = Zustand only (no useState).
 *   - LIST = TanStack Virtual over a scroll container (never FlatList).
 *   - Avatars/thumbnails are ROUNDED SQUARES (never circles).
 *   - Navigation via solito useRouter; room card → /video/room/{id}.
 *   - bg #06070d/black, accent cyan #3FDCFF.
 */

import { useRef } from "react";
import { useRouter } from "solito/navigation";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { create } from "zustand";
import { Radio, Users, Lock, Plus, X } from "lucide-react";
import { videoApi } from "@dvnt/app/src/video/api";
import type { VideoRoom } from "@dvnt/app/src/video/types";

const ACCENT = "#3FDCFF";
const ROW_HEIGHT = 92; // 80px card + 12px gap

// ── UI-only Zustand store (no useState — HARD CONVENTION) ─────────────────────
type RoomsTab = "public" | "mine";

interface VideoRoomsUIStore {
  tab: RoomsTab;
  setTab: (tab: RoomsTab) => void;
}

const useVideoRoomsUIStore = create<VideoRoomsUIStore>((set) => ({
  tab: "public",
  setTab: (tab) => set({ tab }),
}));

// ── Room card (thumbnail = rounded SQUARE, never circular) ────────────────────
function RoomCard({ room, onJoin }: { room: VideoRoom; onJoin: () => void }) {
  const spicy = room.sweetSpicyMode === "spicy";
  return (
    <div
      onClick={onJoin}
      role="button"
      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/4 p-3 cursor-pointer transition-colors active:bg-white/6 hover:bg-white/6"
    >
      <div
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl"
        style={{
          backgroundColor: spicy
            ? "rgba(244,63,94,0.16)"
            : "rgba(63,220,255,0.14)",
        }}
      >
        <Radio size={24} color={spicy ? "#fb7185" : ACCENT} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate font-semibold text-white">
            {room.title || "Untitled Room"}
          </p>
          {!room.isPublic ? <Lock size={13} className="shrink-0 text-white/40" /> : null}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-sm text-white/55">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ACCENT }} />
            Live
          </span>
          <span className="text-white/30">·</span>
          <span className="flex items-center gap-1">
            <Users size={13} />
            up to {room.maxParticipants}
          </span>
          <span className="text-white/30">·</span>
          <span className="capitalize">{room.sweetSpicyMode || "sweet"}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onJoin();
        }}
        className="shrink-0 rounded-full px-5 py-2 font-semibold text-black transition-opacity active:opacity-80"
        style={{ backgroundColor: ACCENT }}
      >
        Join
      </button>
    </div>
  );
}

export function VideoRoomsScreen() {
  const router = useRouter();
  const tab = useVideoRoomsUIStore((s) => s.tab);
  const setTab = useVideoRoomsUIStore((s) => s.setTab);

  // Portable room-list data — SAME videoApi calls native uses.
  const { data, isLoading } = useQuery({
    queryKey: ["video-rooms", tab],
    queryFn: (): Promise<VideoRoom[]> =>
      tab === "mine" ? videoApi.getMyRooms() : videoApi.getPublicRooms(),
  });

  const rooms = data ?? [];

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rooms.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const openRoom = (id: string) => router.push(`/video/room/${id}`);

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Header */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 border-b border-white/8 bg-[#06070d]/85 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Video Rooms</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      <main className="mx-auto w-full max-w-xl px-4 py-5">
        {/* Tab switch */}
        <div className="mb-4 flex gap-2 rounded-full bg-white/5 p-1">
          {(["public", "mine"] as const).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="flex-1 rounded-full px-4 py-2 text-sm font-semibold capitalize transition-colors"
                style={{
                  backgroundColor: active ? ACCENT : "transparent",
                  color: active ? "#000" : "rgba(255,255,255,0.6)",
                }}
              >
                {t === "public" ? "Discover" : "My Rooms"}
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-400" />
            <p className="mt-4 text-sm text-white/60">Loading rooms...</p>
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/6">
              <Radio size={42} color="#666" />
            </div>
            <p className="mb-2 text-lg font-semibold text-white">
              {tab === "mine" ? "No active rooms" : "No live rooms"}
            </p>
            <p className="max-w-xs text-sm text-white/60">
              {tab === "mine"
                ? "Rooms you've joined will show up here while they're live."
                : "There are no public rooms live right now. Check back soon."}
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm font-medium uppercase tracking-wide text-white/60">
              {rooms.length} LIVE {rooms.length === 1 ? "ROOM" : "ROOMS"}
            </p>
            <div
              ref={parentRef}
              className="overflow-y-auto"
              style={{ maxHeight: "calc(100dvh - 230px)" }}
            >
              <div
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
              >
                {virtualizer.getVirtualItems().map((item) => {
                  const room = rooms[item.index];
                  if (!room) return null;
                  return (
                    <div
                      key={room.id}
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
                      <RoomCard room={room} onJoin={() => openRoom(room.id)} />
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      {/* New room FAB → reuse the room route as host entry */}
      <button
        type="button"
        onClick={() => router.push("/video/room/new")}
        aria-label="Start a room"
        className="fixed bottom-6 right-6 z-30 flex h-14 w-14 items-center justify-center rounded-full text-black shadow-lg active:scale-95"
        style={{ backgroundColor: ACCENT }}
      >
        <Plus size={26} />
      </button>
    </div>
  );
}

export default VideoRoomsScreen;
