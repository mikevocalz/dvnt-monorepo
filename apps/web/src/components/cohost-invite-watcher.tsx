"use client";

import dynamic from "next/dynamic";

/**
 * Client-only wrapper for the co-host invite toast.
 *
 * `ssr: false` for the same reason every other RNW surface here is: it reads the
 * auth store, which does not exist during the server render.
 */
const Watcher = dynamic(
  () =>
    import("@dvnt/app/features/sneaky-lynk/ui/web/CohostInvites").then(
      (m) => m.CohostInviteToast,
    ),
  { ssr: false },
);

export function CohostInviteWatcher() {
  return <Watcher />;
}
