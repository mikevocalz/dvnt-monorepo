"use client";

import { useEffect } from "react";
import { useRouter } from "solito/navigation";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

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
    if (hasHydrated && isAuthenticated) router.replace(to);
  }, [hasHydrated, isAuthenticated, router, to]);

  return null;
}
