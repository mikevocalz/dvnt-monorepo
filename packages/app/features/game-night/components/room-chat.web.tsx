"use client";

/**
 * Room chat panel.
 *
 * History comes from fetchRoomMessages (newest-first pages, "load earlier"
 * walks back with beforeId). Live rows arrive over a postgres_changes
 * subscription through freshChannel — raw supabase.channel for
 * postgres_changes is banned in this repo because a remount can hand back an
 * already-joined channel and .on() throws.
 *
 * Sends are optimistic: a pending row goes in immediately, swaps to the real
 * id on success, and flips to failed (tap to retry) on error.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ImagePlay, Loader2, MessageSquare, SendHorizonal } from "lucide-react";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";
import { useChatSheetScroll } from "./use-chat-sheet-scroll";
import { freshChannel } from "@dvnt/app/lib/supabase/realtime";
import { fetchRoomMessages, sendRoomMessage } from "../rooms-api";
import { KlipyGifPicker, type GifPayload } from "./game-night-klipy.web";
import type { GameNightMessage, GameNightState } from "./game-types";
import {
  createRoomReactionEvent,
  emitRoomReaction,
  isRoomReactionEmoji,
  ROOM_REACTIONS,
} from "../motion/room-reactions";

const PAGE = 50;

interface GifData {
  id?: string;
  url?: string;
  preview_url?: string;
  width?: number;
  height?: number;
  provider?: string;
}

interface ChatRow extends GameNightMessage {
  pending?: boolean;
  failed?: boolean;
  /** Local-only key for optimistic rows before the server id exists. */
  localId?: string;
}

interface MessageRow {
  id: number;
  room_id: number;
  user_id: string;
  kind: string;
  body: string | null;
  gif: GifData | null;
  reaction: string | null;
  created_at: string;
}

function toChatRow(r: MessageRow): ChatRow {
  return {
    id: r.id,
    roomId: r.room_id,
    userId: r.user_id,
    kind: r.kind as GameNightMessage["kind"],
    body: r.body,
    gif: r.gif,
    reaction: r.reaction,
    createdAt: r.created_at,
  };
}

export function RoomChat({ state }: { state: GameNightState }) {
  const code = state.room.code;
  const roomId = state.room.id;
  const myId = state.me.user_id;

  // Chat is intentionally closed until summoned. It is a bottom-sheet surface,
  // never a persistent sidebar competing with the game table.
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ChatRow[]>([]); // oldest -> newest
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [showGifs, setShowGifs] = useState(false);
  const [sendPending, setSendPending] = useState(false);
  const {
    listRef,
    onScroll,
    scrollToBottom,
    showNewPill,
    unread,
    noteIncoming,
    jumpToNewest,
  } = useChatSheetScroll(open);

  const nameOf = useCallback(
    (userId: string) =>
      state.members.find((m) => m.user_id === userId)?.name ?? "Someone",
    [state.members],
  );
  const seatOf = useCallback(
    (userId: string) =>
      state.members.find((m) => m.user_id === userId)?.seat_no ?? -1,
    [state.members],
  );

  // Initial page.
  useEffect(() => {
    let cancelled = false;
    void fetchRoomMessages(roomId)
      .then((msgs) => {
        if (cancelled) return;
        setRows([...msgs].reverse());
        setHasMore(msgs.length >= PAGE);
        requestAnimationFrame(scrollToBottom);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [roomId, scrollToBottom]);

  // Live inserts — own channel via freshChannel, never raw supabase.channel.
  useEffect(() => {
    const channel = freshChannel(`game-night-chat:${roomId}`);
    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_night_messages",
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = toChatRow(payload.new as MessageRow);
          if (
            row.kind === "reaction" &&
            row.reaction &&
            row.userId !== myId &&
            isRoomReactionEmoji(row.reaction)
          ) {
            emitRoomReaction(
              createRoomReactionEvent({
                id: `remote-${row.id}`,
                roomId,
                userId: row.userId,
                emoji: row.reaction,
                isMine: false,
                seatIndex: seatOf(row.userId),
                createdAt: Date.parse(row.createdAt) || Date.now(),
              }),
            );
          }
          setRows((prev) => {
            // The sender's optimistic row already occupies this spot.
            if (prev.some((r) => r.id === row.id)) return prev;
            // Claim exactly one matching pending row — rapid identical sends
            // (same reaction tapped twice) must not share the server id.
            const idx = prev.findIndex(
              (r) =>
                r.pending &&
                r.userId === row.userId &&
                r.kind === row.kind &&
                r.body === row.body &&
                r.reaction === row.reaction,
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            return [...prev, row];
          });
          noteIncoming({
            fromMe: row.userId === myId,
            listed: row.kind !== "reaction",
          });
        },
      )
      .subscribe();
    return () => {
      void channel.unsubscribe();
    };
  }, [roomId, myId, noteIncoming, seatOf]);

  const loadEarlier = useCallback(async () => {
    const oldest = rows.find((r) => !r.localId)?.id;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const msgs = await fetchRoomMessages(roomId, oldest);
      setRows((prev) => [...[...msgs].reverse(), ...prev]);
      setHasMore(msgs.length >= PAGE);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      // Leave the button available — a failed page is not the end of history.
    } finally {
      setLoadingOlder(false);
    }
  }, [rows, roomId, loadingOlder]);

  const send = useCallback(
    async (
      kind: "text" | "gif" | "reaction",
      opts: { body?: string; gif?: unknown; reaction?: string },
      localId?: string,
    ) => {
      const id = localId ?? crypto.randomUUID();
      if (!localId) {
        setRows((prev) => [
          ...prev,
          {
            id: -Date.now(),
            localId: id,
            roomId,
            userId: myId,
            kind,
            body: opts.body ?? null,
            gif: (opts.gif as GifData) ?? null,
            reaction: opts.reaction ?? null,
            createdAt: new Date().toISOString(),
            pending: true,
          },
        ]);
        requestAnimationFrame(scrollToBottom);
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.localId === id ? { ...r, pending: true, failed: false } : r,
          ),
        );
      }
      setSendPending(true);
      try {
        const serverId = await sendRoomMessage(code, kind, opts);
        setRows((prev) =>
          prev.map((r) =>
            r.localId === id ? { ...r, id: serverId, pending: false } : r,
          ),
        );
      } catch {
        setRows((prev) =>
          prev.map((r) =>
            r.localId === id ? { ...r, pending: false, failed: true } : r,
          ),
        );
      } finally {
        setSendPending(false);
      }
    },
    [code, myId, scrollToBottom],
  );

  const recentReactions = useMemo(
    () =>
      rows
        .filter((r) => r.kind === "reaction")
        .slice(-8) as ChatRow[],
    [rows],
  );

  const visibleRows = rows.filter((r) => r.kind !== "reaction");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={
          unread > 0
            ? `Open table chat, ${unread} unread message${unread === 1 ? "" : "s"}`
            : "Open table chat"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+104px)] right-4 z-[1200] inline-flex h-12 items-center gap-2 rounded-full border border-[#8A40CF]/45 bg-[#151020]/95 px-4 text-sm font-semibold text-white shadow-[0_14px_38px_rgba(0,0,0,.42)] backdrop-blur-xl transition hover:bg-[#1d162b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C9A2F0] lg:bottom-6 lg:right-6"
      >
        <MessageSquare aria-hidden className="h-4 w-4 text-[#C9A2F0]" />
        Chat
        {unread > 0 ? (
          <span
            aria-hidden
            data-testid="chat-unread-badge"
            className="-mr-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#FC253A] px-1.5 font-mono text-[11px] font-bold leading-none text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        title="Table chat"
        maxWidthClass="max-w-2xl"
        heightClass="h-[75dvh] max-h-[75dvh]"
        footer={
          <div className="w-full">
            <div className="mb-2 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain pb-0.5">
              {ROOM_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`React ${emoji}`}
                  onClick={() => {
                    emitRoomReaction(
                      createRoomReactionEvent({
                        id: `local-chat-${crypto.randomUUID()}`,
                        roomId,
                        userId: myId,
                        emoji,
                        isMine: true,
                        seatIndex: state.me.seat_no ?? -1,
                      }),
                    );
                    void send("reaction", { reaction: emoji });
                  }}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg transition-colors hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#C9A2F0]"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const body = input.trim();
                if (!body || sendPending) return;
                setInput("");
                void send("text", { body });
              }}
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Say something…"
                aria-label="Chat message"
                maxLength={2000}
                className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-white/40 focus:border-[#8A40CF] focus:outline-none"
              />
              <button
                type="button"
                aria-label="Send a GIF"
                aria-pressed={showGifs}
                onClick={() => setShowGifs((v) => !v)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/15 text-white/70 transition-colors hover:bg-white/10"
              >
                <ImagePlay aria-hidden className="h-4 w-4" />
              </button>
              <button
                type="submit"
                aria-label="Send message"
                disabled={!input.trim() || sendPending}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#8A40CF] text-white transition-colors hover:bg-[#7A35BC] disabled:opacity-40"
              >
                <SendHorizonal aria-hidden className="h-4 w-4" />
              </button>
            </form>
          </div>
        }
      >
        <section
          aria-label="Room chat"
          className="flex h-full min-h-0 flex-col"
        >
          {recentReactions.length > 0 ? (
            <div
              aria-label="Recent reactions"
              className="flex shrink-0 flex-wrap gap-1.5 pb-3"
            >
              {recentReactions.map((r) => (
                <span
                  key={r.localId ?? r.id}
                  title={nameOf(r.userId)}
                  className="rounded-full border border-white/10 bg-[#0c0e18]/80 px-2 py-0.5 text-base"
                >
                  {r.reaction}
                </span>
              ))}
            </div>
          ) : null}

          <div className="relative min-h-0 flex-1">
            <div
              ref={listRef}
              onScroll={onScroll}
              className="h-full overflow-y-auto overscroll-contain pr-1"
            >
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadEarlier}
                  disabled={loadingOlder}
                  className="mb-3 w-full rounded-lg border border-white/10 py-1.5 text-xs text-white/55 hover:bg-white/5 disabled:opacity-50"
                >
                  {loadingOlder ? "Loading…" : "Load earlier messages"}
                </button>
              ) : null}
              <ul className="space-y-3">
                {visibleRows.map((m) => (
                  <li key={m.localId ?? m.id} className="text-sm">
                    <span className="font-semibold text-[#C9A2F0]">
                      {m.userId === myId ? "You" : nameOf(m.userId)}
                    </span>{" "}
                    {m.kind === "gif" && m.gif ? (
                      <img
                        src={m.gif.preview_url ?? m.gif.url ?? ""}
                        alt="GIF"
                        className="mt-1 max-h-40 rounded-lg"
                      />
                    ) : (
                      <span
                        className={
                          m.failed
                            ? "text-[#F0A2A2]"
                            : m.pending
                              ? "text-white/45"
                              : "text-white/85"
                        }
                      >
                        {m.body}
                      </span>
                    )}
                    {m.pending ? (
                      <Loader2
                        aria-label="Sending"
                        className="ml-1 inline h-3 w-3 animate-spin text-white/40"
                      />
                    ) : null}
                    {m.failed ? (
                      <button
                        type="button"
                        onClick={() =>
                          m.localId &&
                          send(
                            m.kind,
                            {
                              body: m.body ?? undefined,
                              gif: m.gif ?? undefined,
                              reaction: m.reaction ?? undefined,
                            },
                            m.localId,
                          )
                        }
                        className="ml-2 text-xs font-semibold text-[#F0A2A2] underline"
                      >
                        Failed — retry
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            {showNewPill ? (
              <button
                type="button"
                onClick={jumpToNewest}
                className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-[#8A40CF] px-3 py-1 text-xs font-semibold text-white shadow-lg"
              >
                ↓ New messages
              </button>
            ) : null}
          </div>

          {showGifs ? (
            <div className="mt-3 h-64 shrink-0 overflow-hidden rounded-2xl border border-white/10">
              <KlipyGifPicker
                onPick={(gif: GifPayload) => {
                  setShowGifs(false);
                  void send("gif", { gif });
                }}
              />
            </div>
          ) : null}
        </section>
      </BottomSheet>
    </>
  );
}
