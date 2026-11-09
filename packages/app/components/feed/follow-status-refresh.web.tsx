"use client";

import { useFollowStatusRefresh } from "./use-follow-status-refresh";

export function FollowStatusRefresh({
  targetId,
  showError = true,
  recoverLockedPost = false,
}: {
  targetId?: string;
  showError?: boolean;
  recoverLockedPost?: boolean;
}) {
  const status = useFollowStatusRefresh(targetId, recoverLockedPost);
  if (status.data !== "pending" && !status.isError) return null;

  return (
    <div className="mt-2 text-center text-sm">
      {showError && status.isError && (
        <p role="alert">Could not check follow status. Please try again.</p>
      )}
      <button
        type="button"
        disabled={status.isFetching}
        aria-busy={status.isFetching}
        onClick={() => void status.refresh()}
        className="min-h-11 rounded-lg px-3 text-cyan-300 disabled:opacity-50"
      >
        {status.isFetching
          ? "Checking…"
          : status.isError
            ? "Retry follow status"
            : "Check request status"}
      </button>
    </div>
  );
}
