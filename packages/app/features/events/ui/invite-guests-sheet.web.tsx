"use client";
/**
 * InviteGuestsSheet (web) — the host's way of sharing a private event.
 *
 * A copied link can never open a private event: can_view_event admits only
 * the host, co-organizers, event_invites rows and admission ticket holders.
 * This sheet picks members (one batched `event-invite-guests` call — the edge
 * fn rate-limits writes at 5 per 5 min per event, so per-tap invites would
 * cap out), grants each a guest-list row + notification, then sends a DM card
 * so the invitee has a tappable route in.
 *
 * Mirrors the private branch of share-event-sheet.tsx on native.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { BottomSheet } from "@dvnt/app/components/bottom-sheet.web";
import { useDebounce } from "@dvnt/app/lib/hooks/use-debounce";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import { usersApi } from "@dvnt/app/lib/api/users";
import { messagesApi } from "@dvnt/app/lib/api/messages-impl";
import { inviteEventGuests } from "@dvnt/app/lib/api/privileged";

type UserResult = {
  id: string;
  authId: string;
  username: string;
  name: string;
  avatar: string;
};

export function InviteGuestsSheet({
  open,
  onClose,
  eventId,
  eventTitle,
  eventDate,
  eventImage,
  eventLocation,
}: {
  open: boolean;
  onClose: () => void;
  eventId: number;
  eventTitle: string;
  eventDate?: string;
  eventImage?: string;
  eventLocation?: string;
}) {
  const showToast = useUIStore((s) => s.showToast);
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);
  const [results, setResults] = useState<UserResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Map<string, UserResult>>(new Map());
  const [inviting, setInviting] = useState(false);
  // Strict-mode-safe stale-response guard.
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSelected(new Map());
    }
  }, [open]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    usersApi
      .searchUsers(q, 20)
      .then(({ docs }) => {
        if (seq === searchSeq.current) setResults(docs as UserResult[]);
      })
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
  }, [debouncedQuery]);

  const toggle = (user: UserResult) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });

  const invite = async () => {
    if (inviting || selected.size === 0) return;
    setInviting(true);
    try {
      const guests = [...selected.values()];
      const res = await inviteEventGuests(
        eventId,
        guests.map((g) => g.username),
      );
      // Members the edge fn skipped (e.g. resolved to the host) get no DM —
      // they have no invite row, so the card would open a refusal.
      const skippedNames = new Set(
        (res.skipped ?? []).map((s) =>
          s.recipient.replace(/^@/, "").toLowerCase(),
        ),
      );
      const reachable = guests.filter(
        (g) => !skippedNames.has(g.username.toLowerCase()),
      );
      await Promise.allSettled(
        reachable.map(async (g) => {
          const conversationId = await messagesApi.getOrCreateConversation(
            g.authId || g.id,
          );
          await messagesApi.sendMessage({
            conversationId,
            content: `You're invited: ${eventTitle}`,
            metadata: {
              type: "event_share",
              event_id: String(eventId),
              event_title: eventTitle,
              event_date: eventDate ?? null,
              event_image: eventImage ?? null,
              event_location: eventLocation ?? null,
            },
          });
        }),
      );
      const skippedMsg = res.skipped?.length
        ? ` ${res.skipped.length} skipped (${res.skipped[0].reason}).`
        : "";
      showToast(
        "success",
        "Invites sent",
        `${reachable.length} guest${reachable.length === 1 ? "" : "s"} can now open this event.${skippedMsg}`,
      );
      onClose();
    } catch (err) {
      showToast(
        "error",
        "Invite failed",
        (err as Error)?.message || "Try again.",
      );
    } finally {
      setInviting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Invite guests"
      footer={
        <button
          type="button"
          onClick={invite}
          disabled={inviting || selected.size === 0}
          className="w-full rounded-xl bg-[#3FDCFF] py-3.5 text-sm font-bold text-[#0b0d16] transition-opacity disabled:opacity-40"
        >
          {inviting
            ? "Inviting…"
            : selected.size === 0
              ? "Select guests to invite"
              : `Invite ${selected.size} guest${selected.size === 1 ? "" : "s"}`}
        </button>
      }
    >
      <p className="mb-3 text-xs text-white/45">
        This event is private — guests you invite can open it, and get a DM
        with the event.
      </p>
      <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.06] px-3.5 py-2.5">
        <Search size={16} color="rgba(255,255,255,0.35)" />
        <input
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="Search people…"
          aria-label="Search for a guest by name or username"
          autoCapitalize="none"
          autoCorrect="off"
          className="flex-1 bg-transparent text-sm text-white placeholder-white/30 outline-none"
        />
        {searching ? (
          <span className="text-xs text-white/35">Searching…</span>
        ) : null}
      </div>
      <ul className="divide-y divide-white/[0.06]">
        {results.map((u) => {
          const isSelected = selected.has(u.id);
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => toggle(u)}
                className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-white/[0.04]"
                aria-pressed={isSelected}
              >
                {u.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={u.avatar}
                    alt=""
                    className="h-11 w-11 rounded-full object-cover"
                  />
                ) : (
                  <span className="h-11 w-11 rounded-full bg-white/[0.08]" />
                )}
                <span className="flex-1">
                  <span className="block text-sm font-semibold text-white">
                    @{u.username}
                  </span>
                  {u.name && u.name !== u.username ? (
                    <span className="block text-xs text-white/45">
                      {u.name}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-full border-[1.5px] ${
                    isSelected
                      ? "border-[#3FDCFF] bg-[#3FDCFF]"
                      : "border-white/25"
                  }`}
                >
                  {isSelected ? <Check size={14} color="#0b0d16" /> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {debouncedQuery.trim().length > 1 && !searching && results.length === 0 ? (
        <p className="mt-8 text-center text-sm text-white/30">No users found</p>
      ) : null}
    </BottomSheet>
  );
}
