"use client";

/**
 * Pending co-host invitations — WEB.
 *
 * Structural references (Mobbin, structure only):
 *   PlayStation App — party invite card: source label, who invited, one
 *     full-width primary action. The closest analog; a Lynk invite is a live
 *     session, so the dominant action is "get me in", not "read more".
 *   Swarm — a pending request pinned ABOVE the dated notification feed, with a
 *     filled Accept and an outline Decline. Actionable items outrank history.
 *   Superlist — team invite with a quiet secondary chip.
 *   Hypelist / Beli — right-aligned per-row action, consistent affordance.
 *
 * Two surfaces, one hook, deliberately:
 *   `CohostInviteToast` is the interruption — it fires when the invite arrives.
 *   `PendingCohostInvites` is the memory — it sits at the top of Notifications
 *   so dismissing the toast, or closing the tab, costs nothing. A live room is
 *   time-bounded; an invite you cannot get back to is an invite you missed.
 *
 * Accepting routes STRAIGHT into the room, already elevated. That is the whole
 * point: the server grants the seat and hands back the room id, so saying yes
 * is one decision, not "accept" followed by "now go find it".
 */

import { useEffect, useRef } from "react";
import { useRouter } from "solito/navigation";
import { toast } from "sonner";
import { Radio } from "lucide-react";

import {
  useMyAuthId,
  usePendingCohostInvites,
  useRespondToCohostInvite,
  type LynkCohostInvite,
} from "@dvnt/app/lib/hooks/use-lynk-cohost-invites";

const ACCENT = "#3FDCFF";

/** Shared accept/decline behaviour so the toast and the list cannot drift. */
function useInviteActions() {
  const router = useRouter();
  const { data: authId } = useMyAuthId();
  const respond = useRespondToCohostInvite(authId ?? undefined);

  const accept = (invite: LynkCohostInvite) =>
    respond.mutate(
      { inviteId: invite.id, action: "accept" },
      {
        onSuccess: (result) => {
          if (result.status !== "accepted") return;
          toast.success("You're a co-host");
          // `viaInvite=1` skips the pre-join gate: the seat is already granted,
          // so asking "do you want to join?" again is asking twice.
          router.push(
            `/feed/sneaky-lynk/room/${result.roomId}?hasVideo=1&viaInvite=1`,
          );
        },
        // Named, not generic: "couldn't accept" leaves you guessing whether to
        // retry. The server's message says whether the Lynk simply ended.
        onError: (err: Error) =>
          toast.error(err.message || "Couldn't join as co-host"),
      },
    );

  const decline = (invite: LynkCohostInvite) =>
    respond.mutate(
      { inviteId: invite.id, action: "decline" },
      { onError: (err: Error) => toast.error(err.message || "Couldn't decline") },
    );

  return { accept, decline, pending: respond.isPending };
}

/**
 * Raises a Sonner toast the first time each invite is seen.
 *
 * Mount once, globally. The `seen` ref is what keeps it from re-toasting on
 * every poll — the query refetches on an interval, and an invite that is still
 * pending is not a new invite. Dismissing is safe: the row below persists it.
 */
export function CohostInviteToast() {
  const { data } = usePendingCohostInvites();
  const { accept, decline } = useInviteActions();
  const seen = useRef(new Set<number>());

  useEffect(() => {
    for (const invite of data ?? []) {
      if (seen.current.has(invite.id)) continue;
      seen.current.add(invite.id);
      toast(invite.roomTitle || "You've been invited to co-host", {
        description: "Join as a co-host and you can speak right away.",
        duration: 30_000,
        action: { label: "Join", onClick: () => accept(invite) },
        cancel: { label: "Not now", onClick: () => decline(invite) },
      });
    }
  }, [data, accept, decline]);

  return null;
}

/**
 * The durable copy, pinned above the notification feed.
 *
 * Renders nothing when there is nothing pending — an empty "invitations"
 * heading is a dead end, and this list already has a real empty state below it.
 */
export function PendingCohostInvites() {
  const { data } = usePendingCohostInvites();
  const { accept, decline, pending } = useInviteActions();
  const invites = data ?? [];
  if (invites.length === 0) return null;

  return (
    <section className="border-b border-white/8 px-4 py-3">
      {invites.map((invite) => (
        <div
          key={invite.id}
          className="flex items-start gap-3 rounded-2xl bg-white/[0.06] p-3"
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${ACCENT}1f`, color: ACCENT }}
          >
            <Radio size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-white">
              Invitation to co-host
            </p>
            <p className="mt-0.5 truncate text-sm text-white/60">
              {invite.roomTitle || "A Lynk is live"}
            </p>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => accept(invite)}
                className="rounded-full px-4 py-1.5 text-sm font-bold text-black disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                Join as co-host
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => decline(invite)}
                className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-semibold text-white/80 disabled:opacity-50"
              >
                Decline
              </button>
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
