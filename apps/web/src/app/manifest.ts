import type { MetadataRoute } from "next";

/**
 * PWA manifest — Next.js App Router serves this at /manifest.webmanifest.
 *
 * Required by C2 (iOS PWA install funnel): without a valid manifest + SW +
 * HTTPS, Safari refuses to offer Add-to-Home-Screen. The criteria that
 * iOS enforces have no API to query — the only signal we get is that
 * `display-mode: standalone` becomes true once installed.
 *
 * Icons fall back to the existing email glyph until a proper 192/512
 * maskable set ships. Flagged in TASKS.md D5.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DVNT",
    short_name: "DVNT",
    description:
      "DVNT — connect, gather, move culture on your own terms.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0408",
    theme_color: "#0a0408",
    icons: [
      // Same artwork as the mobile app icon (apps/mobile/assets/images/icon.png),
      // resized to the PWA sizes so home-screen installs match the native app.
      {
        src: "/pwa-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/pwa-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
