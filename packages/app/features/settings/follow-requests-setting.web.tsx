"use client";

import { ChevronRight, UserCheck } from "lucide-react";
import { useRouter } from "solito/navigation";
import { useFollowRequests } from "@dvnt/app/lib/hooks/use-follow-requests";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export function FollowRequestsSetting() {
  const owner = useAuthStore((s) => s.user?.id);
  return owner ? <RequestSetting key={owner} /> : null;
}

function RequestSetting() {
  const router = useRouter();
  const { query } = useFollowRequests();
  const count = query.data?.length ?? 0;
  const value = query.isLoading
    ? "Loading…"
    : query.isError
      ? "Check requests"
      : `${count} pending`;

  return (
    <button
      type="button"
      onClick={() => router.push("/settings/privacy#follow-requests")}
      className="flex w-full items-center justify-between border-b border-white/8 px-1 py-3.5 active:bg-white/5 last:border-0"
    >
      <span className="flex items-center gap-3">
        <UserCheck size={20} className="text-white/60" aria-hidden="true" />
        <span className="text-[15px] font-medium text-white">
          Follow requests
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="text-sm text-white/60">{value}</span>
        <ChevronRight size={18} className="text-white/40" aria-hidden="true" />
      </span>
    </button>
  );
}
