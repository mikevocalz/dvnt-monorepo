"use client";

import { Toaster } from "sonner";

/**
 * Web toast host. The RNW auth screens (LoginScreen.web, SignupScreen.web,
 * Forgot/Reset/VerifyEmail) call `toast.*` from `sonner`, but nothing mounted
 * a `<Toaster/>` on web — only the native layout mounts `sonner-native`'s
 * Toaster — so every web toast was a silent no-op (e.g. a login error showed
 * nothing). Mounting this once at the frontend root makes those toasts render.
 *
 * Dark + richColors to match the app's branded native toaster (errors red,
 * success green); same dark card surface (#1a1a1a / #333 border).
 */
export function WebToaster() {
  return (
    <Toaster
      position="top-center"
      theme="dark"
      richColors
      closeButton
      toastOptions={{
        style: {
          background: "#1a1a1a",
          border: "1px solid #333",
          color: "#fff",
        },
      }}
    />
  );
}
