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

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  Crown,
  Hand,
  LoaderCircle,
  MessageCircle,
  Mic,
  MicOff,
  Search,
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
const FOCUS_RING = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3FDCFF]";

// Reference-count background isolation so overlapping panels can close in
// either order without unlocking the room beneath the remaining dialog.
const isolatedBranches = new WeakMap<HTMLElement, { count: number; wasInert: boolean }>();
const panelStack: Array<{ root: HTMLElement; panel: HTMLElement }> = [];

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
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() || "?";
  if (uri && uri !== failedUri) {
    return (
      <img
        src={uri}
        alt={name}
        width={size}
        height={size}
        onError={() => setFailedUri(uri)}
        className="shrink-0 rounded-xl object-cover bg-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className="flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.08] font-semibold text-white/80"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      <span aria-hidden="true">{initial}</span>
    </span>
  );
}

function PanelEmptyState({ icon, title, children }: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-xs flex-col items-center px-4 py-10 text-center">
      <span aria-hidden="true" className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-[#3FDCFF]">{icon}</span>
      <p className="text-base font-semibold text-white">{title}</p>
      <p className="mt-2 text-sm leading-6 text-white/60">{children}</p>
    </div>
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
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const root = rootRef.current;
    if (!panel || !root) return;
    panelStack.push({ root, panel });
    for (const entry of panelStack) entry.root.inert = entry.panel !== panel;
    // Make aria-modal real: hide every background branch from pointer,
    // keyboard and assistive-technology navigation while keeping the scrim active.
    const background: HTMLElement[] = [];
    let branch = rootRef.current as HTMLElement | null;
    while (branch?.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement && !sibling.hasAttribute("data-room-side-panel-root")) {
          const state = isolatedBranches.get(sibling);
          if (state) state.count += 1;
          else isolatedBranches.set(sibling, { count: 1, wasInert: sibling.inert });
          background.push(sibling);
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
      if (branch === document.body) break;
    }
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'));
    (focusable()[0] ?? panel)?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || panelStack.at(-1)?.panel !== panel) return;
      // A later confirmation dialog may be rendered in a portal above this one.
      const targetDialog = (event.target as HTMLElement | null)?.closest?.('[role="dialog"], [role="alertdialog"]');
      if (targetDialog && targetDialog !== panel) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = focusable();
        const first = items[0];
        const last = items[items.length - 1];
        if (!first) { event.preventDefault(); panel?.focus(); return; }
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panel || !panel?.contains(active))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const wasTop = panelStack.at(-1)?.panel === panel;
      const index = panelStack.findIndex((entry) => entry.panel === panel);
      if (index >= 0) panelStack.splice(index, 1);
      for (const element of background) {
        const state = isolatedBranches.get(element);
        if (state && --state.count === 0) {
          element.inert = state.wasInert;
          isolatedBranches.delete(element);
        }
      }
      const next = panelStack.at(-1);
      if (next) next.root.inert = false;
      const restoreFocus = next && !next.panel.contains(previousFocus) ? next.panel : previousFocus;
      if (wasTop && restoreFocus?.isConnected && !restoreFocus.closest('[inert]')) {
        restoreFocus.focus({ preventScroll: true });
      }
    };
  }, [open]);
  if (!open) return null;
  return (
    <div ref={rootRef} data-room-side-panel-root className="contents">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 z-40 cursor-default bg-black/60 sm:bg-black/40"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        aria-modal="true"
        style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
        className="absolute inset-x-0 bottom-0 z-50 flex h-[85%] max-h-full w-full flex-col overflow-hidden rounded-t-3xl border-t border-white/10 bg-[#0b0d14] outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-h-none sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0"
        role="dialog"
        aria-labelledby={titleId}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-lg bg-white/25 sm:hidden" aria-hidden="true" />
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 pb-3 pt-2 sm:pt-[calc(var(--lynk-safe-top,env(safe-area-inset-top))+12px)]">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-white">
            <span aria-hidden="true" className="shrink-0">{icon}</span>
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/80 hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        {children}
      </aside>
    </div>
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
  roomId,
}: {
  open: boolean;
  onClose: () => void;
  comments: RoomComment[];
  onSend: (body: string) => Promise<boolean>;
  currentUserId: string | undefined;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  /** Optional identity boundary for a room reused without remounting. */
  roomId?: string;
}) {
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [draftLength, setDraftLength] = useState(0);
  const draftRef = useRef("");
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedToLatest = useRef(true);
  const previousIds = useRef<Set<number>>(new Set());
  const draftScope = `${roomId ?? ""}:${currentUserId ?? ""}`;
  const scopeRef = useRef(draftScope);
  const scopeVersion = useRef(0);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const composerHintId = useId();
  const sendErrorId = useId();

  useEffect(() => {
    if (scopeRef.current === draftScope) return;
    scopeRef.current = draftScope;
    scopeVersion.current += 1;
    draftRef.current = "";
    if (inputRef.current) inputRef.current.value = "";
    sendingRef.current = false;
    setSending(false);
    setSendError(null);
    setDraftLength(0);
  }, [draftScope]);

  const jumpToLatest = useCallback(() => {
    pinnedToLatest.current = true;
    setHasNewMessages(false);
    const list = scrollRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, []);

  // Do not yank a reader out of history. A deletion or an older-history
  // snapshot also must not be announced as a new message.
  useEffect(() => {
    if (open) jumpToLatest();
  }, [open, draftScope, jumpToLatest]);
  useEffect(() => {
    const lastMessageId = comments.at(-1)?.id;
    const hasIncoming = lastMessageId !== undefined && !previousIds.current.has(lastMessageId);
    previousIds.current = new Set(comments.map((comment) => comment.id));
    if (!open) return;
    if (pinnedToLatest.current) jumpToLatest();
    else if (hasIncoming) setHasNewMessages(true);
  }, [open, comments, jumpToLatest]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const input = inputRef.current;
      const body = input?.value.trim();
      if (!input || !body || disabled || sendingRef.current) return;
      draftRef.current = input.value;
      const submissionScope = scopeVersion.current;
      sendingRef.current = true;
      setSending(true);
      setSendError(null);
      jumpToLatest();
      try {
        const sent = await onSend(body);
        if (scopeVersion.current !== submissionScope) return;
        if (sent) {
          // Keep text typed while sending, including after close/reopen.
          if (draftRef.current.trim() === body) {
            draftRef.current = "";
            if (inputRef.current) inputRef.current.value = "";
            setDraftLength(0);
          }
        } else {
          setSendError("Message not sent. Your draft is saved here. Try sending again.");
        }
      } catch {
        if (scopeVersion.current === submissionScope) {
          setSendError("Message not sent. Your draft is saved here. Try sending again.");
        }
      } finally {
        if (scopeVersion.current === submissionScope) {
          sendingRef.current = false;
          setSending(false);
        }
      }
    },
    [onSend, disabled, jumpToLatest],
  );

  return (
    <SidePanel open={open} onClose={onClose} title="Chat" icon={<MessageCircle size={18} color={ACCENT} />}>
      <div className="shrink-0 border-b border-white/[0.06] px-4 py-3">
        <p className="text-xs leading-5 text-white/60">Messages are visible to everyone in this Lynk.</p>
      </div>
      <div
        ref={scrollRef}
        data-room-chat-messages
        role="log"
        aria-label="Room messages"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={loading && comments.length === 0}
        onScroll={(event) => {
          const list = event.currentTarget;
          pinnedToLatest.current = list.scrollHeight - list.clientHeight - list.scrollTop < 40;
          if (pinnedToLatest.current) setHasNewMessages(false);
        }}
        className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-3"
      >
        {comments.length === 0 ? (
          <PanelEmptyState
            icon={loading ? <LoaderCircle size={22} className="animate-spin motion-reduce:animate-none" /> : error ? <AlertCircle size={22} /> : <MessageCircle size={22} />}
            title={loading ? "Opening chat" : error ? "Chat is unavailable" : "Break the ice"}
          >
            {loading ? "Loading the latest room messages…" : error ? "Messages will appear here when chat reconnects." : "Say hello, share a thought, or keep the conversation going."}
          </PanelEmptyState>
        ) : (
          comments.map((comment, index) => {
            const isOwn = comment.authorId === currentUserId;
            const previous = comments[index - 1];
            const created = new Date(comment.createdAt);
            const previousTime = previous ? new Date(previous.createdAt) : null;
            const validTime = Number.isFinite(created.getTime());
            const sameDay = validTime && previousTime?.toDateString() === created.toDateString();
            const gap = previousTime ? created.getTime() - previousTime.getTime() : Infinity;
            const grouped = !!previous && previous.authorId === comment.authorId && sameDay && gap >= 0 && gap < 5 * 60_000;
            const name = isOwn ? "You" : getSneakyUserLabel(comment.author);
            const time = validTime ? created.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
            return (
              <div key={comment.id}>
                {validTime && !sameDay ? (
                  <p className="flex items-center gap-3 py-3 text-[11px] text-white/50">
                    <span aria-hidden="true" className="h-px flex-1 bg-white/[0.08]" />
                    <time dateTime={created.toISOString()}>{created.toLocaleDateString([], { month: "short", day: "numeric" })}</time>
                    <span aria-hidden="true" className="h-px flex-1 bg-white/[0.08]" />
                  </p>
                ) : null}
                <div className={grouped ? "flex gap-2.5" : "mt-3 flex gap-2.5"}>
                  <span className="w-7 shrink-0" aria-hidden="true">
                    {grouped ? null : <SquareAvatar uri={comment.author?.isAnonymous ? undefined : comment.author?.avatar} name={name} size={28} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    {grouped ? <span className="sr-only">{name}: </span> : (
                      <div className="mb-1 flex items-baseline gap-2">
                        <span className="truncate text-xs font-semibold text-white/80">{name}</span>
                        {time ? <time dateTime={created.toISOString()} title={created.toLocaleString()} className="shrink-0 font-mono text-[10px] text-white/50">{time}</time> : null}
                      </div>
                    )}
                    <p className={`whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-sm leading-6 [overflow-wrap:anywhere] ${isOwn ? "bg-[#3FDCFF]/15 text-white" : "bg-white/[0.06] text-white/90"} ${comment.isOptimistic ? "opacity-60" : ""}`}>
                      {comment.body}
                    </p>
                    {comment.isOptimistic ? <p className="mt-1 text-[11px] text-white/50">Sending…</p> : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {hasNewMessages ? (
        <button type="button" onClick={jumpToLatest} aria-label="Jump to latest messages" className={`mx-4 mb-3 flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-[#3FDCFF]/25 bg-[#3FDCFF]/10 px-3 text-sm font-semibold text-[#3FDCFF] ${FOCUS_RING}`}>
          <ArrowDown size={16} aria-hidden="true" /> New messages · Jump to latest
        </button>
      ) : null}
      {error || sendError ? (
        <p id={sendErrorId} role="alert" className="mx-4 mb-3 rounded-lg border border-red-300/20 bg-red-300/[0.06] px-3 py-2 text-sm leading-5 text-red-200">{sendError || error}</p>
      ) : null}
      <form
        onSubmit={submit}
        className="shrink-0 border-t border-white/10 px-4 pt-3"
        style={{ paddingBottom: "calc(var(--lynk-safe-bottom, env(safe-area-inset-bottom)) + 12px)" }}
      >
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            defaultValue={draftRef.current}
            onChange={(event) => {
              draftRef.current = event.currentTarget.value;
              setDraftLength(event.currentTarget.value.length);
              setSendError(null);
            }}
            type="text"
            placeholder={disabled ? "Chat is not ready…" : "Say something…"}
            aria-label="Message"
            aria-describedby={`${composerHintId}${error || sendError ? ` ${sendErrorId}` : ""}`}
            disabled={disabled}
            maxLength={500}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2.5 text-base text-white placeholder:text-white/50 focus:border-[#3FDCFF]/60 focus:outline-none focus:ring-1 focus:ring-[#3FDCFF]/60 disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={disabled || sending}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#3FDCFF] text-black transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${FOCUS_RING}`}
          >
            {sending ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
          </button>
        </div>
        <div className="mt-2 flex min-h-4 items-center justify-between gap-2 text-[11px] text-white/50">
          <p id={composerHintId} role="status">{disabled ? "Chat is not ready. Your draft stays here." : sending ? "Sending message…" : "Enter to send"}</p>
          {draftLength >= 400 ? <span className="shrink-0 font-mono" aria-label={`${500 - draftLength} characters remaining`}>{draftLength}/500</span> : null}
        </div>
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
  /** Existing room callback grants co-host; the action names that authority. */
  onInviteToSpeak: (userId: string) => void;
  onLowerHand: (userId: string) => void;
  onLowerAll: () => void;
}) {
  // Queue semantics, labels and copy are shared with native — see ui/hand-queue.
  const queue = buildHandQueue(
    order,
    members.filter((m) => m.status === "active").map((m) => ({
      userId: m.userId,
      username: m.username,
      displayName: m.displayName,
      avatar: m.avatar,
      isAnonymous: m.isAnonymous,
      anonLabel: m.anonLabel,
    })),
  );

  const waiting = queue.filter((entry) => !entry.departed).length;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={`${HAND_QUEUE_COPY.title} · ${queue.length}`}
      icon={<Hand size={18} color={MAGENTA} />}
    >
      {queue.length > 0 ? (
        <div className="shrink-0 border-b border-white/[0.06] px-4 py-3">
          <p className="text-sm font-medium text-white/80">{waiting} {waiting === 1 ? "person" : "people"} waiting to speak</p>
          <p className="mt-1 text-xs leading-5 text-white/60">Oldest hand first. Making someone a co-host lets them speak and help moderate this Lynk.</p>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {queue.length === 0 ? (
          <PanelEmptyState icon={<Hand size={22} />} title="Everyone's caught up">
            {HAND_QUEUE_COPY.empty}
          </PanelEmptyState>
        ) : (
          <ol className="space-y-3" aria-label="Raised hands, oldest first">
            {queue.map((entry) => (
              <li key={entry.userId} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center gap-3">
                  <span aria-label={`Position ${entry.position}`} className="w-5 shrink-0 text-center font-mono text-xs text-white/60">{entry.position}</span>
                  <span aria-hidden="true"><SquareAvatar uri={entry.avatar} name={entry.label} size={36} /></span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm font-medium ${entry.departed ? "text-white/50" : "text-white"}`}>{entry.label}</p>
                    <p className="mt-0.5 text-xs text-white/50">{entry.departed ? "No longer waiting" : "Wants to speak"}</p>
                  </div>
                  {!entry.departed ? <Hand size={16} color={MAGENTA} aria-hidden="true" /> : null}
                </div>
                {entry.departed ? null : (
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onInviteToSpeak(entry.userId)}
                      aria-label={`Make ${entry.label} a co-host`}
                      className={`flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-[#3FDCFF]/10 px-3 py-2 text-xs font-semibold text-[#3FDCFF] hover:bg-[#3FDCFF]/20 ${FOCUS_RING}`}
                    >
                      <Crown size={15} aria-hidden="true" /> Make co-host
                    </button>
                    <button
                      type="button"
                      onClick={() => onLowerHand(entry.userId)}
                      aria-label={`${HAND_QUEUE_COPY.lower} ${entry.label}`}
                      className={`min-h-11 rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-white/70 hover:bg-white/[0.08] hover:text-white ${FOCUS_RING}`}
                    >
                      {HAND_QUEUE_COPY.lower}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      {queue.length > 0 ? (
        <footer className="shrink-0 border-t border-white/10 px-4 pt-3" style={{ paddingBottom: "calc(var(--lynk-safe-bottom, env(safe-area-inset-bottom)) + 12px)" }}>
          <button type="button" onClick={onLowerAll} className={`min-h-11 w-full rounded-lg bg-white/[0.08] px-3 py-2.5 text-sm font-semibold text-white hover:bg-white/15 ${FOCUS_RING}`}>
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
 * Voice activity is shown only when supplied by the live presence source.
 * Do not infer mute state from a person being quiet: silence is not a mute.
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
  const [search, setSearch] = useState("");
  const active = members.filter((m) => m.status === "active");
  // Use the authoritative active roster, not the initial join role: promotion,
  // demotion and removal must update controls without leaving the room.
  const actorRole = active.find((m) => m.userId === localUserId)?.role;
  const isHost = actorRole === "host";
  const canModerate = isHost || actorRole === "co-host" || actorRole === "moderator";
  const query = search.trim().toLocaleLowerCase();
  const matches = (member: WebMember) => getSneakyUserLabel(member).toLocaleLowerCase().includes(query);
  const roleRank = (role: string) => role === "host" ? 0 : role === "co-host" ? 1 : role === "moderator" ? 2 : 3;
  const onStage = active.filter((member) => member.role !== "listener" && matches(member)).sort((a, b) => roleRank(a.role) - roleRank(b.role));
  const listening = active.filter((member) => member.role === "listener" && matches(member));
  const matchCount = onStage.length + listening.length;
  const controlClass = `flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg bg-white/[0.06] px-1 py-2 text-[10px] font-medium text-white/80 hover:bg-white/10 hover:text-white ${FOCUS_RING}`;

  const row = (member: WebMember) => {
    const isSelf = member.userId === localUserId;
    const isRoomHost = member.role === "host";
    const name = getSneakyUserLabel(member);
    const speaking = member.role !== "listener" && !!speakingByUserId?.[member.userId];
    const roleLabel = isRoomHost ? "Host" : member.role === "co-host" ? "Co-host" : member.role === "moderator" ? "Moderator" : member.role === "listener" ? "Listening" : "On stage";
    return (
      <li key={member.userId} className={`rounded-xl border p-3 ${speaking ? "border-[#3FDCFF]/30 bg-[#3FDCFF]/[0.04]" : "border-white/10 bg-white/[0.04]"}`}>
        <div className="flex items-center gap-3">
          <span aria-hidden="true"><SquareAvatar uri={member.isAnonymous ? undefined : member.avatar} name={name} size={40} /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white" title={`${name}${isSelf ? " (you)" : ""}`}>
              {name}{isSelf ? <span className="font-normal text-white/50"> (you)</span> : null}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/60">
              <span className={isRoomHost || member.role === "co-host" ? "text-[#3FDCFF]" : undefined}>{roleLabel}</span>
              {speaking ? <span className="flex items-center gap-1 text-[#3FDCFF]"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#3FDCFF]" /> Speaking</span> : null}
              {member.handRaised ? <span className="flex items-center gap-1 text-[#FF5BFC]"><Hand size={12} aria-hidden="true" /> Hand raised</span> : null}
            </div>
          </div>
          {isRoomHost ? <Crown size={16} color={ACCENT} aria-hidden="true" /> : null}
        </div>
        {canModerate && !isSelf && !isRoomHost ? (
          <div role="group" aria-label={`Manage ${name}`} className="mt-3 grid grid-flow-col auto-cols-fr gap-1.5 border-t border-white/[0.06] pt-3">
            <button type="button" onClick={() => onUnmute(member.userId)} aria-label={`Let ${name} unmute`} title="Allow them to unmute their own microphone" className={controlClass}>
              <Mic size={16} aria-hidden="true" /> Allow mic
            </button>
            <button type="button" onClick={() => onMute(member.userId)} aria-label={`Mute ${name}`} title={`Mute ${name}`} className={controlClass}>
              <MicOff size={16} aria-hidden="true" /> Mute
            </button>
            {isHost && member.role === "co-host" ? (
              <button type="button" onClick={() => onDemote(member.userId)} aria-label={`Remove co-host from ${name}`} title="Remove co-host role; keep them on stage" className={controlClass}>
                <UserMinus size={16} aria-hidden="true" /> Remove role
              </button>
            ) : null}
            {isHost && member.role !== "co-host" ? (
              <button type="button" onClick={() => onPromote(member.userId)} aria-label={`Make ${name} a co-host`} title="Give co-host moderation controls" className={`${controlClass} !bg-[#3FDCFF]/10 !text-[#3FDCFF] hover:!bg-[#3FDCFF]/20`}>
                <Crown size={16} aria-hidden="true" /> Co-host
              </button>
            ) : null}
            {!(actorRole === "moderator" && member.role === "moderator") ? (
              <button type="button" onClick={() => onKick(member.userId)} aria-label={`Remove ${name} from the room`} title={`Remove ${name} from the room`} className={`${controlClass} !bg-[#FC253A]/10 !text-red-300 hover:!bg-[#FC253A]/20`}>
                <UserX size={16} aria-hidden="true" /> Remove
              </button>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  };

  const section = (label: string, rows: WebMember[]) => rows.length ? (
    <section className="space-y-2">
      <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-white/60">{label} <span className="ml-1 font-mono text-white/40">{rows.length}</span></h3>
      <ul className="space-y-2" aria-label={label}>{rows.map(row)}</ul>
    </section>
  ) : null;

  return (
    <SidePanel open={open} onClose={onClose} title={`In the room · ${active.length}`} icon={<Users size={18} color={ACCENT} />}>
      {active.length > 8 || search ? (
        <div className="shrink-0 border-b border-white/[0.06] px-4 py-3">
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 focus-within:border-[#3FDCFF]/60">
            <Search size={16} className="shrink-0 text-white/50" aria-hidden="true" />
            <input type="search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} aria-label="Search people in this Lynk" placeholder="Find someone" className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-white outline-none placeholder:text-white/50" />
          </label>
          {query ? <p role="status" className="mt-2 text-xs text-white/60">{matchCount} {matchCount === 1 ? "person" : "people"} found</p> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {active.length === 0 ? (
          <PanelEmptyState icon={<Users size={22} />} title="The room is quiet">
            People will appear here as they join.
          </PanelEmptyState>
        ) : matchCount === 0 ? (
          <div>
            <PanelEmptyState icon={<Search size={22} />} title="No matching names">
              Try another display name or clear your search.
            </PanelEmptyState>
            <button type="button" onClick={() => setSearch("")} className={`min-h-11 w-full rounded-lg bg-white/[0.08] px-3 text-sm font-semibold text-white ${FOCUS_RING}`}>Clear search</button>
          </div>
        ) : <>{section("On stage", onStage)}{section("Listening", listening)}</>}
      </div>
      {canModerate ? (
        <footer className="shrink-0 space-y-3 border-t border-white/10 px-4 pt-3" style={{ paddingBottom: "calc(var(--lynk-safe-bottom, env(safe-area-inset-bottom)) + 12px)" }}>
          <p className="text-xs leading-5 text-white/60">Allow mic lifts a host mute. Each person chooses when to turn their microphone on.</p>
          {isHost && onMuteAll && active.length > 1 ? (
            <button type="button" onClick={onMuteAll} className={`flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-3 py-2.5 text-sm font-semibold text-white hover:bg-white/15 ${FOCUS_RING}`}>
              <MicOff size={16} aria-hidden="true" /> Mute everyone
            </button>
          ) : null}
        </footer>
      ) : null}
    </SidePanel>
  );
}
