"use client";
import { useFollowRequests } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
export function FollowRequestsPanel() {
  const owner = useAuthStore(s => s.user?.id);
  return owner ? <Requests key={owner} /> : null;
}
function Requests() {
  const { query, mutation } = useFollowRequests();
  return <section className="mt-4 rounded-2xl border border-white/10 p-4" aria-label="Follow requests">
    <h2 className="font-semibold">Follow requests</h2>
    <p className="mt-1 text-sm text-white/60">Approve members to let them see your private posts. Existing followers need your approval too.</p>
    {query.isLoading ? <p role="status">Loading requests…</p> : query.isError ? <div role="alert">Could not load requests. <button onClick={() => void query.refetch()}>Retry</button></div> : query.data?.length ? query.data.map(request => <div key={request.follower_id} className="flex items-center gap-3 border-t border-white/10 py-3">
      <span className="flex-1">{request.requester?.username || "Member"}</span>
      <button className="rounded-lg bg-cyan-400 px-3 py-2 text-black" disabled={mutation.isPending} onClick={() => mutation.mutate({ requesterId: String(request.follower_id), action: "approve" })}>Approve</button>
      <button className="rounded-lg border border-white/20 px-3 py-2" disabled={mutation.isPending} onClick={() => mutation.mutate({ requesterId: String(request.follower_id), action: "decline" })}>Decline</button>
    </div>) : <p className="mt-3 text-sm text-white/60">No pending requests.</p>}
    {mutation.isError ? <p role="alert">{mutation.error.message}</p> : null}
  </section>;
}
