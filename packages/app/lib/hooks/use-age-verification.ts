import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { onboardingCheckpoint, onboardingFailure } from "@dvnt/observability/flows";

/**
 * B3 deferred ID verification (Didit). Status vocabulary mirrors the
 * identity_verifications CHECK constraint:
 * pending | submitted | passed | failed | expired | review — plus "none".
 */

export type AgeVerificationStatus =
  | "none"
  | "pending"
  | "submitted"
  | "passed"
  | "failed"
  | "expired"
  | "review";

export const ageVerificationKeys = {
  status: ["age-verification", "status"] as const,
};

/** Own-row read via RLS (identity_verifications_own SELECT policy). */
export function useAgeVerificationStatus() {
  const authId = useAuthStore((s) => s.user?.authId);
  return useQuery({
    queryKey: ageVerificationKeys.status,
    enabled: !!authId,
    staleTime: 30_000,
    queryFn: async (): Promise<AgeVerificationStatus> => {
      const { data } = await supabase
        .from("identity_verifications")
        .select("status")
        .maybeSingle();
      return (data?.status as AgeVerificationStatus) ?? "none";
    },
  });
}

/** True when the event needs verification and the viewer doesn't have it. */
export function needsAgeVerification(
  ageRestriction: string | undefined | null,
  status: AgeVerificationStatus | undefined,
): boolean {
  const restricted = ageRestriction === "18+" || ageRestriction === "21+";
  return restricted && status !== "passed";
}

/** Starts (or resumes) a Didit session; returns the hosted capture URL. */
export function useStartVerification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (opts?: { returnUrl?: string }) => {
      onboardingCheckpoint("verification.capture_start");
      const token = await requireBetterAuthToken();
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        data?: { status: string; url?: string; sessionId?: string };
        error?: { code: string; message: string };
      }>("create-verification-session", {
        body: { returnUrl: opts?.returnUrl },
        headers: { Authorization: `Bearer ${token}`, "x-auth-token": token },
      });
      if (error) throw new Error(error.message || "Couldn't start verification");
      if (!data?.ok || !data.data) {
        throw new Error(data?.error?.message || "Couldn't start verification");
      }
      return data.data;
    },
    onSuccess: (data) => {
      if (data.status === "passed") {
        onboardingCheckpoint("verification.verified");
        queryClient.setQueryData(ageVerificationKeys.status, "passed");
      }
    },
    onError: (error) => {
      onboardingFailure("verification.capture_start", error);
    },
  });
}

/** Re-pull status after returning from the hosted flow. */
export function useRefreshVerificationStatus() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: ageVerificationKeys.status });
}
