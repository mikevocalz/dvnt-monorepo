"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Radio } from "lucide-react";
import { useMyAuthId, usePendingCohostInvites } from "@dvnt/app/lib/hooks/use-lynk-cohost-invites";
import { useCohostInviteActions } from "../../hooks/useCohostInviteActions";

const ACCENT = "#3FDCFF";

/** Toast dismissal is not a decline. The explicit choice remains in Activity. */
export function CohostInviteToast() {
  const { data: authId } = useMyAuthId();
  const { data } = usePendingCohostInvites();
  const { accept } = useCohostInviteActions("web");
  const seen = useRef(new Set<number>());
  const visible = useRef(new Map<number, string | number>());

  useEffect(() => {
    seen.current.clear();
    return () => {
      for (const id of visible.current.values()) toast.dismiss(id);
      visible.current.clear();
    };
  }, [authId]);

  useEffect(() => {
    const active = new Set((data ?? []).map((invite) => invite.id));
    for (const [inviteId, toastId] of visible.current) {
      if (!active.has(inviteId)) {
        toast.dismiss(toastId);
        visible.current.delete(inviteId);
      }
    }
    for (const invite of data ?? []) {
      if (seen.current.has(invite.id)) continue;
      seen.current.add(invite.id);
      const id = toast(invite.roomTitle || "Invitation to co-host", {
        description: "Your existing room identity stays the same. New members use their profile. You'll review your camera and microphone before joining.",
        duration: 30_000,
        action: { label: "Accept invite", onClick: () => accept(invite) },
        cancel: { label: "Not now", onClick: () => {} },
      });
      visible.current.set(invite.id, id);
    }
  }, [data, accept]);
  return null;
}

/** Durable, explicit consent survives dismissing a toast or reopening the app. */
export function PendingCohostInvites() {
  const query = usePendingCohostInvites();
  const { accept, decline, pending, variables } = useCohostInviteActions("web");
  const invites = query.data ?? [];
  if (!query.isError && invites.length === 0) return null;
  return (
    <section aria-label="Co-host invitations" className="space-y-3 border-b border-white/8 px-4 py-3">
      {query.isError && (
        <div role="status" className="rounded-2xl border border-white/10 p-4 text-sm text-white/70">
          <p>Co-host invitations couldn't refresh. Try again to see what's current.</p>
          <button type="button" onClick={() => { void query.refetch(); }} disabled={query.isFetching}
            className="mt-2 min-h-11 rounded-xl px-3 font-semibold text-[#3FDCFF] focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
            {query.isFetching ? "Refreshing…" : "Retry invitations"}
          </button>
        </div>
      )}
      {invites.map((invite) => {
        const responding = pending && variables?.inviteId === invite.id;
        const title = invite.roomTitle || "Live Lynk";
        return (
          <article key={invite.id} aria-label={`Co-host invitation: ${title}`} aria-busy={responding}
            className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${ACCENT}1f`, color: ACCENT }}><Radio size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-white">Invitation to co-host</p>
              <p className="mt-0.5 break-words text-sm text-white/80">{title}</p>
              <p className="mt-1 text-xs leading-5 text-white/55">Help manage the room. Your existing room identity stays the same. New members use their profile. Review your camera and microphone before joining. Room limits still apply.</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" disabled={pending} onClick={() => accept(invite)} aria-label={`Accept co-host invitation to ${title}`}
                  className="min-h-11 rounded-full px-4 py-2 text-sm font-bold text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-50"
                  style={{ backgroundColor: ACCENT }}>
                  {responding && variables?.action === "accept" ? "Accepting…" : "Accept & review"}
                </button>
                <button type="button" disabled={pending} onClick={() => decline(invite)} aria-label={`Decline co-host invitation to ${title}`}
                  className="min-h-11 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/80 focus-visible:outline focus-visible:outline-2 disabled:opacity-50">
                  {responding && variables?.action === "decline" ? "Declining…" : "Decline"}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}
