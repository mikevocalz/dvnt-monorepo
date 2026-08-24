"use client";

/**
 * Sneaky Lynk room — WEB side panels.
 *
 * Lifted out of room.web.tsx, which had grown past 2,200 lines with these
 * living inline. They are pure presentation: every one is driven entirely by
 * props and closes over nothing in the room screen, which is why they move
 * without a seam.
 *
 * Web-only by design and so deliberately NOT in the four-file shape. Native
 * renders the same information as gorhom bottom sheets; a side panel and a
 * bottom sheet are different affordances, not one component forked. What the
 * two legs share is the behaviour and the words — ui/hand-queue for the queue
 * semantics and copy, lib/user-label for anonymity-safe names — so the parts
 * that can drift are shared and the chrome that should differ is not.
 *
 * HARD CONVENTIONS (inherited from room.web.tsx): raw semantic HTML + Tailwind
 * className only, no <View>/<Text>. Avatars are rounded squares.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  Ban,
  Check,
  Crown,
  Hand,
  MessageCircle,
  Mic,
  MicOff,
  Send,
  UserMinus,
  Users,
  UserX,
  X,
} from "lucide-react";

import { getSneakyUserLabel } from "@dvnt/app/lib/user-label";
import { buildHandQueue, HAND_QUEUE_COPY } from "../hand-queue";
import type { RoomComment } from "../../api/comments";

/** DVNT tokens — docs/dvnt-design-system.md §1. */
const ACCENT = "#3FDCFF";
const MAGENTA = "#FF5BFC";


export interface WebMember {
  userId: string;
  role: string;
  status: string;
  handRaised: boolean;
  username?: string;
  displayName?: string;
  avatar?: string;
  isAnonymous?: boolean;
  anonLabel?: string | null;
}

export function SquareAvatar({
  uri,
  name,
  size,
}: {
  uri?: string;
  name: string;
  size: number;
}) {
  if (uri) {
    return (
      <img
        src={uri}
        alt={name}
        className="rounded-2xl object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-2xl bg-white/10 flex items-center justify-center font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {(name?.[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function SidePanel({
  open,
  onClose,
  title,
  icon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 z-40 bg-black/50 sm:bg-black/30"
      />
      <aside
        className="absolute inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-[#0b0d14] shadow-2xl"
        role="dialog"
        aria-label={title}
      >
        <header className="flex items-center justify-between border-b border-white/8 px-4 py-3">
          <span className="flex items-center gap-2 text-base font-semibold text-white">
            {icon}
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white hover:bg-white/15"
          >
            <X size={16} />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}

export function ChatPanel({
  open,
  onClose,
  comments,
  onSend,
  currentUserId,
}: {
  open: boolean;
  onClose: () => void;
  comments: RoomComment[];
  onSend: (body: string) => void;
  currentUserId: string | undefined;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, comments.length]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      onSend(el.value);
      el.value = "";
    },
    [onSend],
  );

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Chat"
      icon={<MessageCircle size={18} className="text-cyan-400" />}
    >
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {comments.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            No messages yet. Say hi 👋
          </p>
        ) : (
          comments.map((c) => {
            const isOwn = c.authorId === currentUserId;
            return (
              <div key={c.id} className="flex items-start gap-2">
                <SquareAvatar
                  uri={c.author?.avatar}
                  name={getSneakyUserLabel(c.author)}
                  size={28}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-semibold text-white/70">
                    {isOwn ? "You" : getSneakyUserLabel(c.author)}
                  </span>
                  <p
                    className={`mt-0.5 break-words rounded-2xl px-3 py-1.5 text-sm ${
                      isOwn ? "bg-cyan-500/20 text-white" : "bg-white/8 text-white/90"
                    } ${c.isOptimistic ? "opacity-60" : ""}`}
                  >
                    {c.body}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-white/8 px-3 py-3"
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Message…"
          maxLength={500}
          className="flex-1 rounded-full bg-white/8 px-4 py-2.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <button
          type="submit"
          aria-label="Send"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-500 text-black hover:bg-cyan-400"
        >
          <Send size={18} />
        </button>
      </form>
    </SidePanel>
  );
}

export function HandQueuePanel({
  open,
  onClose,
  order,
  members,
  onInviteToSpeak,
  onLowerHand,
  onLowerAll,
}: {
  open: boolean;
  onClose: () => void;
  order: string[];
  members: WebMember[];
  onInviteToSpeak: (userId: string) => void;
  onLowerHand: (userId: string) => void;
  onLowerAll: () => void;
}) {
  // Queue semantics, labels and copy are shared with native — see ui/hand-queue.
  const queue = buildHandQueue(
    order,
    members.map((m) => ({
      userId: m.userId,
      username: m.username,
      displayName: m.displayName,
      avatar: m.avatar,
      isAnonymous: m.isAnonymous,
      anonLabel: m.anonLabel,
    })),
  );

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`${HAND_QUEUE_COPY.title} · ${queue.length}`}
      icon={<Hand size={18} color={MAGENTA} />}
    >
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {queue.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            {HAND_QUEUE_COPY.empty}
          </p>
        ) : (
          queue.map((entry) => (
            <div
              key={entry.userId}
              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
            >
              <span className="w-4 shrink-0 text-center font-mono text-xs font-bold text-white/40">
                {entry.position}
              </span>
              <SquareAvatar uri={entry.avatar} name={entry.label} size={36} />
              <span
                className={`flex-1 truncate text-sm font-medium ${
                  entry.departed ? "italic text-white/40" : "text-white"
                }`}
              >
                {entry.label}
              </span>
              {entry.departed ? null : (
                <>
                  <button
                    type="button"
                    onClick={() => onInviteToSpeak(entry.userId)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
                    style={{ backgroundColor: `${ACCENT}20`, color: ACCENT }}
                  >
                    <Crown size={13} /> {HAND_QUEUE_COPY.invite}
                  </button>
                  <button
                    type="button"
                    onClick={() => onLowerHand(entry.userId)}
                    aria-label={`${HAND_QUEUE_COPY.lower} ${entry.label}`}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-semibold text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
                  >
                    {HAND_QUEUE_COPY.lower}
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
      {queue.length > 0 ? (
        <footer className="border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onLowerAll}
            className="w-full rounded-lg bg-white/[0.08] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            {HAND_QUEUE_COPY.lowerAll}
          </button>
        </footer>
      ) : null}
    </SidePanel>
  );
}

export function ParticipantsPanel({
  open,
  onClose,
  members,
  isHost,
  localUserId,
  onPromote,
  onDemote,
  onKick,
  onMute,
  onUnmute,
}: {
  open: boolean;
  onClose: () => void;
  members: WebMember[];
  isHost: boolean;
  localUserId: string | undefined;
  onPromote: (userId: string) => void;
  onDemote: (userId: string) => void;
  onKick: (userId: string) => void;
  onMute: (userId: string) => void;
  onUnmute: (userId: string) => void;
}) {
  const active = members.filter((m) => m.status === "active");
  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`In the room · ${active.length}`}
      icon={<Users size={18} className="text-cyan-400" />}
    >
      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {active.map((m) => {
          const name = getSneakyUserLabel(m);
          const isSelf = m.userId === localUserId;
          const isRoomHost = m.role === "host";
          return (
            <div
              key={m.userId}
              className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2"
            >
              <SquareAvatar uri={m.avatar} name={name} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-white">
                  {name}
                  {isSelf ? " (you)" : ""}
                </span>
                {m.role !== "listener" ? (
                  <span className="text-[11px] uppercase tracking-wide text-cyan-400/80">
                    {m.role}
                  </span>
                ) : null}
              </span>
              {isHost && !isSelf && !isRoomHost ? (
                <span className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onUnmute(m.userId)}
                    aria-label={`Let ${name} unmute`}
                    title="Lift the mute — they choose when to speak"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white/80 hover:bg-white/15"
                  >
                    <Mic size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onMute(m.userId)}
                    aria-label={`Mute ${name}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white/80 hover:bg-white/15"
                  >
                    <MicOff size={14} />
                  </button>
                  {m.role === "co-host" ? (
                    <button
                      type="button"
                      onClick={() => onDemote(m.userId)}
                      aria-label="Demote to listener"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                    >
                      <UserMinus size={14} />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onPromote(m.userId)}
                      aria-label="Promote to co-host"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30"
                    >
                      <Crown size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onKick(m.userId)}
                    aria-label="Remove from room"
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                  >
                    <UserX size={14} />
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </SidePanel>
  );
}

