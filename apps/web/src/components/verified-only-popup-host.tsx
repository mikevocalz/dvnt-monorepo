"use client";

import dynamic from "next/dynamic";

/**
 * Client-only host for the verified-only popup. `ssr: false` because it reads
 * the auth store and the verdict query, neither of which exist on the server.
 * Signed out, the verdict query never runs and the popup never opens.
 */
const Popup = dynamic(
  () =>
    import("@dvnt/app/components/verified-only-popup").then(
      (m) => m.VerifiedOnlyPopup,
    ),
  { ssr: false },
);

export function VerifiedOnlyPopupHost() {
  return <Popup />;
}
