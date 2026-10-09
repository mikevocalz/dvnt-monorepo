"use client";

import dynamic from "next/dynamic";

/**
 * Client-only host for the profile-completion popup and new-member gate.
 * Loaded with `next/dynamic` so its Dialog, Supabase and profile-sync imports
 * stay out of the shared chunks every visitor downloads on first load (the
 * static import added ~650 KB to the shared payload). `ssr: false` because it
 * reads the auth store, which does not exist on the server.
 */
const Popup = dynamic(
  () => import("./profile-completion-popup").then((m) => m.ProfileCompletionPopup),
  { ssr: false },
);

export function ProfileCompletionPopupHost() {
  return <Popup />;
}
