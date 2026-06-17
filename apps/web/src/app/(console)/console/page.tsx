"use client";
import dynamic from "next/dynamic";

/**
 * DVNT moderation console at /console.
 *
 * AdminApp is a self-contained client SPA (its own login gate + QueryClient +
 * tab nav) that talks to the in-app Payload REST at /payload-api. It fetches
 * session/auth on mount, so render it client-only (ssr:false) — matching how
 * web-vite served it. Payload's own CMS admin lives at /admin.
 */
const AdminApp = dynamic(
  () => import("@/dashboard/AdminApp").then((m) => m.AdminApp),
  { ssr: false },
);

export default function ConsolePage() {
  return <AdminApp />;
}
