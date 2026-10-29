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

import { useCallback, useEffect, useRef, useState } from "react";
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
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
    ) ?? []);
    focusable()[0]?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }
    };
    panel?.addEventListener("keydown", onKeyDown);
    return () => {
      panel?.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);
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
        ref={panelRef}
        aria-modal="true"
        style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
        className="absolute inset-x-0 bottom-0 z-50 flex h-[85%] max-h-full w-full flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-[#0b0d14] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0"
        role="dialog"
        aria-label={title}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/25 sm:hidden" aria-hidden="true" />
        <header className="flex shrink-0 items-center justify-between border-b border-white/8 px-4 pb-2 pt-2 sm:pt-[calc(var(--lynk-safe-top,env(safe-area-inset-top))+8px)]">
          <span className="flex items-center gap-2 text-base font-semibold text-white">
            {icon}
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/8 text-white hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]"
          >
            <X size={16} />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}

/**
 * Room chat.
 *
 * Consecutive messages from the same person are grouped: the avatar and name
 * appear once and the following lines indent under them. Repeating both on
 * every line — which is what this did — turns a normal back-and-forth into a
 * wall of duplicated identity and pushes the actual words into a narrow column.
 *
 * Timestamps appear on the first message of each group. A live room is a
 * timeline; "when was that said" was unanswerable.
 */
export function ChatPanel({
  open,
  onClose,
  comments,
  onSend,
  currentUserId,
  loading = false,
  error = null,
  disabled = false,
}: {
  open: boolean;
  onClose: () => void;
  comments: RoomComment[];
  onSend: (body: string) => Promise<boolean>;
  currentUserId: string | undefined;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToLatest = useRef(true);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const lastMessageId = comments.at(-1)?.id;

  const jumpToLatest = useCallback(() => {
    pinnedToLatest.current = true;
    setHasNewMessages(false);
    const list = scrollRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, []);

  // Reopening chat starts at the latest message. Incoming messages only follow
  // while already pinned; a busy room must not yank someone out of history.
  useEffect(() => {
    if (open) jumpToLatest();
  }, [open, jumpToLatest]);
  useEffect(() => {
    if (!open) return;
    if (pinnedToLatest.current) jumpToLatest();
    else if (lastMessageId !== undefined) setHasNewMessages(true);
  }, [open, comments.length, lastMessageId, jumpToLatest]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const el = inputRef.current;
      if (!el) return;
      // Guarded: the input fed onSend raw, so Enter on an empty field posted a
      // blank message into the room.
      const body = el.value.trim();
      if (!body || disabled || sendingRef.current) return;
      sendingRef.current = true;
      setSending(true);
      jumpToLatest();
      try {
        if (await onSend(body)) {
          if (el.value.trim() === body) el.value = "";
        }
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [onSend, disabled, jumpToLatest],
  );

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Chat"
      icon={<MessageCircle size={18} color="#3FDCFF" />}
    >
      <div
        ref={scrollRef}
        data-room-chat-messages
        onScroll={(event) => {
          const list = event.currentTarget;
          pinnedToLatest.current = list.scrollHeight - list.clientHeight - list.scrollTop < 40;
          if (pinnedToLatest.current) setHasNewMessages(false);
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {comments.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            {loading ? "Loading chat…" : "No messages yet. Say hi 👋"}
          </p>
        ) : (
          comments.map((c, idx) => {
            const isOwn = c.authorId === currentUserId;
            const prev = comments[idx - 1];
            // Same author in an unbroken run reads as one turn, not N turns.
            const grouped = !!prev && prev.authorId === c.authorId;
            const name = isOwn ? "You" : getSneakyUserLabel(c.author);
            const time = c.createdAt
              ? new Date(c.createdAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })
              : null;
            return (
              <div key={c.id} className={grouped ? "flex gap-2" : "mt-3 flex gap-2"}>
                <span className="w-7 shrink-0">
                  {grouped ? null : (
                    <SquareAvatar uri={c.author?.avatar} name={name} size={28} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  {grouped ? null : (
                    <span className="flex items-baseline gap-2">
                      <span className="truncate text-xs font-semibold text-white/70">
                        {name}
                      </span>
                      {time ? (
                        // Mono for the clock — the design system's rule for
                        // temporal data, and it stops timestamps jittering as
                        // digits change width.
                        <span className="shrink-0 font-mono text-[10px] text-white/30">
                          {time}
                        </span>
                      ) : null}
                    </span>
                  )}
                  <p
                    className={`mt-0.5 break-words rounded-2xl px-3 py-1.5 text-sm ${
                      isOwn ? "bg-[#3FDCFF]/20 text-white" : "bg-white/8 text-white/90"
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
      {hasNewMessages ? (
        <button type="button" onClick={jumpToLatest} aria-label="Jump to latest messages" className="mx-4 min-h-11 shrink-0 rounded-lg bg-[#3FDCFF]/20 px-3 text-sm font-semibold text-[#3FDCFF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#3FDCFF]">
          New messages · Jump to latest
        </button>
      ) : null}
      {error ? <p role="alert" className="px-4 py-2 text-sm text-red-300">{error}</p> : null}
      <form
        onSubmit={submit}
        className="flex shrink-0 items-center gap-2 border-t border-white/8 px-3 pt-3"
        style={{ paddingBottom: "calc(var(--lynk-safe-bottom, env(safe-area-inset-bottom)) + 12px)" }}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder="Message…"
          aria-label="Message"
          disabled={disabled || sending}
          maxLength={500}
          className="min-w-0 flex-1 rounded-lg bg-white/8 px-4 py-2.5 text-base text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-[#3FDCFF]"
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={disabled || sending}
          // The hover colour matched the base, so the control gave no feedback.
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#3FDCFF] text-black transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
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

/**
 * Who is in the room, and the host's controls over them.
 *
 * Sectioned by role rather than one flat list. A room with a host, two speakers
 * and forty listeners is not a list of forty-three equal rows — the host is
 * looking for the people who can talk, and a flat list buries them. Section
 * headers carry counts so "how many are here" is answered without counting.
 *
 * Per-row status ("speaking", "muted", "muted by you") because a mic glyph
 * alone cannot distinguish someone who chose to mute from someone the host
 * muted, and those need different actions.
 *
 * Mute-everyone lives in a footer, separated from per-row controls: it is the
 * one action here that affects people who are not on screen.
 */
export function ParticipantsPanel({
  open,
  onClose,
  members,
  localUserId,
  onPromote,
  onDemote,
  onKick,
  onMute,
  onUnmute,
  onMuteAll,
  speakingByUserId,
}: {
  open: boolean;
  onClose: () => void;
  members: WebMember[];
  localUserId: string | undefined;
  onPromote: (userId: string) => void;
  onDemote: (userId: string) => void;
  onKick: (userId: string) => void;
  onMute: (userId: string) => void;
  onUnmute: (userId: string) => void;
  onMuteAll?: () => void;
  /** Live voice activity, so a row can say "speaking" rather than just showing a mic. */
  speakingByUserId?: Record<string, boolean>;
}) {
  const active = members.filter((m) => m.status === "active");
  // Use the authoritative active roster, not the initial join role: promotion,
  // demotion and removal must update controls without leaving the room.
  const actorRole = active.find((m) => m.userId === localUserId)?.role;
  const isHost = actorRole === "host";
  const canModerate = isHost || actorRole === "co-host" || actorRole === "moderator";
  const onStage = active.filter((m) => m.role !== "listener");
  const listening = active.filter((m) => m.role === "listener");

  const row = (m: WebMember) => {
    const isSelf = m.userId === localUserId;
    const isRoomHost = m.role === "host";
    const name = getSneakyUserLabel(m);
    const speaking = !!speakingByUserId?.[m.userId];
    return (
      <div
        key={m.userId}
        className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
      >
        <SquareAvatar uri={m.avatar} name={name} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-white">
            {name}
            {isSelf ? " (you)" : ""}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-white/45">
            {m.role !== "listener" ? (
              <span className="uppercase tracking-wide text-[#3FDCFF]/80">{m.role}</span>
            ) : null}
            {speaking ? <span className="text-[#3FDCFF]">speaking</span> : null}
          </span>
        </span>
        {canModerate && !isSelf && !isRoomHost ? (
          <span className="flex shrink-0 items-center gap-1.5">
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
            {isHost && m.role === "co-host" ? (
              <button
                type="button"
                onClick={() => onDemote(m.userId)}
                aria-label={`Remove co-host from ${name}`}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/8 text-white/80 hover:bg-white/15"
              >
                <UserMinus size={14} />
              </button>
            ) : null}
            {isHost && m.role !== "co-host" ? (
              <button
                type="button"
                onClick={() => onPromote(m.userId)}
                aria-label={`Make ${name} a co-host`}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#3FDCFF]/20 text-[#3FDCFF] hover:bg-[#3FDCFF]/30"
              >
                <Crown size={14} />
              </button>
            ) : null}
            {!(actorRole === "moderator" && m.role === "moderator") ? (
              <button
                type="button"
                onClick={() => onKick(m.userId)}
                aria-label={`Remove ${name} from the room`}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FC253A]/20 text-[#FC253A] hover:bg-[#FC253A]/30"
              >
                <UserX size={14} />
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
    );
  };

  const section = (label: string, rows: WebMember[]) =>
    rows.length ? (
      <section className="space-y-2">
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">
          {label} · {rows.length}
        </h3>
        {rows.map(row)}
      </section>
    ) : null;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`In the room · ${active.length}`}
      icon={<Users size={18} color="#3FDCFF" />}
    >
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {active.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/40">
            Nobody else is here yet.
          </p>
        ) : (
          <>
            {section("On stage", onStage)}
            {section("Listening", listening)}
          </>
        )}
      </div>
      {isHost && onMuteAll && active.length > 1 ? (
        <footer className="border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={onMuteAll}
            className="w-full rounded-lg bg-white/[0.08] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/15"
          >
            Mute everyone
          </button>
        </footer>
      ) : null}
    </SidePanel>
  );
}

