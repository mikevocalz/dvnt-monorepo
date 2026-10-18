"use client";

import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { getSession } from "@dvnt/app/lib/auth-client";

/**
 * Renders nothing; once the persisted auth store has hydrated, sends an already
 * -authenticated user to `to` (default /feed). Mount on public pages (landing,
 * login) so a logged-in visitor lands straight on the feed instead of the
 * marketing/login UI.
 */
export function RedirectIfAuthed({ to = "/feed" }: { to?: string }) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  useEffect(() => {
    if (!hasHydrated || !isAuthenticated) return;

    // A persisted app profile alone does not prove the browser still has a
    // Better Auth session. A stale profile otherwise loops between /admin and
    // /auth/login because the editor correctly refuses unauthenticated users.
    if (to === "/admin" || to.startsWith("/admin/")) {
      let active = true;
      void getSession()
        .then(({ data }) => {
          if (active && data?.session && data?.user) router.replace(to);
        })
        .catch(() => {
          // Stay on the real DVNT sign-in form; do not trust stale local state.
        });
      return () => { active = false; };
    }

    router.replace(to);
  }, [hasHydrated, isAuthenticated, router, to]);

  return null;
}
