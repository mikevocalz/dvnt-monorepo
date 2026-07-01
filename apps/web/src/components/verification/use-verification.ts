"use client";

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

/**
 * useVerification — single read path for "is the user identity-verified?".
 *
 *   - Read goes through Supabase RPC `is_verified(uid)` (I3). Never reads
 *     the provider SDK on the client.
 *   - `startVerification()` POSTs the route that pre-creates the row and
 *     returns the Persona Hosted Flow URL — caller redirects the user.
 *
 * The C2 funnel order (install → verification → first Lynk) is enforced
 * by the caller composing this with `usePwaStore.isStandalone`, NOT by
 * this hook. Keeping the policy at the call site avoids hidden global
 * dependencies on PWA state from non-PWA routes (e.g. an admin reviewer).
 */
export type VerificationStatus =
  | "pending"
  | "submitted"
  | "passed"
  | "failed"
  | "expired"
  | "review"
  | "none";

async function readStatus(userId: string): Promise<VerificationStatus> {
  // is_verified() returns boolean; for the surface UI we also want to
  // distinguish pending / submitted / failed, so we read the row body.
  const { data, error } = await supabase
    .from("identity_verifications")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return ((data as { status?: VerificationStatus })?.status) ?? "none";
}

export function useVerification(): {
  status: VerificationStatus;
  isVerified: boolean;
  isLoading: boolean;
  refetch: () => void;
  startVerification: (returnPath?: string) => Promise<{ url: string } | null>;
  starting: boolean;
  error: string | null;
} {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const query = useQuery({
    queryKey: ["identity-verification", userId],
    enabled: !!userId,
    staleTime: 15_000,
    queryFn: () => readStatus(userId as string),
  });

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startVerification = useCallback(
    async (returnPath?: string): Promise<{ url: string } | null> => {
      if (!userId) return null;
      setStarting(true);
      setError(null);
      try {
        const res = await fetch("/api/verification/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ returnPath }),
        });
        const json = (await res.json()) as { url?: string; error?: string };
        if (!res.ok || !json.url) {
          setError(json.error ?? `start failed (${res.status})`);
          return null;
        }
        return { url: json.url };
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setStarting(false);
      }
    },
    [userId],
  );

  const status = (query.data ?? "none") as VerificationStatus;

  return {
    status,
    isVerified: status === "passed",
    isLoading: query.isLoading,
    refetch: () => void query.refetch(),
    startVerification,
    starting,
    error,
  };
}
