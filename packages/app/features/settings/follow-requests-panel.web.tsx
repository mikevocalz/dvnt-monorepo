"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  getSessionLifecycle,
  subscribeSessionLifecycle,
} from "@dvnt/app/lib/auth/session-lifecycle";
import {
  getFollowIdentityRevision,
  subscribeFollowIdentityRevision,
} from "@dvnt/app/lib/auth/follow-identity";
import { useFollowRequests } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function FollowRequestsPanel() {
  const owner = useAuthStore((s) => s.user?.id);
  const session = useSyncExternalStore(
    subscribeSessionLifecycle,
    getSessionLifecycle,
    getSessionLifecycle,
  );
  const revision = useSyncExternalStore(
    subscribeFollowIdentityRevision,
    getFollowIdentityRevision,
    getFollowIdentityRevision,
  );
  return owner ? (
    <Requests key={`${owner}:${session.epoch}:${revision}`} />
  ) : null;
}

function Requests() {
  const { query, mutation } = useFollowRequests();
  const inFlight = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.location.hash !== "#follow-requests") return;
    sectionRef.current?.scrollIntoView({ block: "start" });
    sectionRef.current?.focus({ preventScroll: true });
  }, []);

  const respond = async (
    requesterId: string,
    action: "approve" | "decline",
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await mutation.mutateAsync({ requesterId, action });
    } catch {
      // The mutation error is shown below, and the request stays available to retry.
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <section
      ref={sectionRef}
      id="follow-requests"
      tabIndex={-1}
      className="my-4 scroll-mt-24 rounded-2xl border border-white/10 p-4"
      aria-label="Follow requests"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">Follow requests</h2>
        {!query.isError && (
          <button
            type="button"
            aria-label="Refresh follow requests"
            disabled={query.isFetching || mutation.isPending}
            onClick={() => void query.refetch()}
            className="min-h-11 rounded-lg px-3 text-sm text-cyan-300 disabled:opacity-50"
          >
            {query.isFetching && !query.isLoading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-white/60">
        Approve members to let them see your private posts. Existing followers
        need your approval too.
      </p>
      {query.isLoading ? (
        <p role="status" className="mt-3 text-sm text-white/60">
          Loading requests…
        </p>
      ) : query.isError ? (
        <div role="alert" className="mt-3 text-sm">
          Could not load requests. Please try again.
          <button
            type="button"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
            className="ml-2 min-h-11 rounded-lg px-3 text-cyan-300 disabled:opacity-50"
          >
            {query.isFetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : query.data?.length ? (
        <ul className="mt-3">
          {query.data.map((request) => {
            const requesterId = String(request.follower_id);
            const username = request.requester?.username;
            const label = username || "Member";
            const pending =
              mutation.isPending &&
              mutation.variables?.requesterId === requesterId;
            return (
              <li
                key={requesterId}
                className="flex flex-wrap items-center gap-3 border-t border-white/10 py-3"
              >
                {username ? (
                  <a
                    href={`/profile/${encodeURIComponent(username)}`}
                    aria-label={`View ${username}'s profile`}
                    className="min-w-0 flex-1 break-words py-2 text-cyan-300 underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {username}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1">{label}</span>
                )}
                <div className="flex gap-2">
                  {(["approve", "decline"] as const).map((action) => {
                    const busy =
                      pending && mutation.variables?.action === action;
                    const text = action === "approve" ? "Approve" : "Decline";
                    return (
                      <button
                        key={action}
                        type="button"
                        aria-label={`${text} ${label}'s follow request`}
                        aria-busy={busy}
                        disabled={mutation.isPending}
                        onClick={() => void respond(requesterId, action)}
                        className={`min-h-11 rounded-lg px-3 py-2 disabled:opacity-50 ${action === "approve" ? "bg-cyan-400 text-black" : "border border-white/20"}`}
                      >
                        {busy
                          ? action === "approve"
                            ? "Approving…"
                            : "Declining…"
                          : text}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p role="status" className="mt-3 text-sm text-white/60">
          No pending requests. New follow requests will appear here.
        </p>
      )}
      {mutation.isPending && (
        <p role="status" className="mt-2 text-sm text-white/60">
          {mutation.variables?.action === "approve"
            ? "Approving request…"
            : "Declining request…"}
        </p>
      )}
      {mutation.isSuccess && (
        <p role="status" className="mt-2 text-sm text-white/60">
          {mutation.variables?.action === "approve"
            ? "Request approved."
            : "Request declined."}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          Could not{" "}
          {mutation.variables?.action === "approve" ? "approve" : "decline"}{" "}
          request. {mutation.error?.message} Please try again.
        </p>
      )}
    </section>
  );
}
