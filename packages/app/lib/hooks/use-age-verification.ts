import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { onboardingCheckpoint, onboardingFailure } from "@dvnt/observability/flows";
import { validateDateOfBirth } from "@dvnt/app/lib/utils/age-verification";

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
    queryKey: [...ageVerificationKeys.status, authId],
    enabled: !!authId,
    staleTime: 30_000,
    queryFn: async (): Promise<AgeVerificationStatus> => {
      const { data } = await supabase
        .from("identity_verifications")
        .select("status, date_of_birth")
        .eq("user_id", authId!)
        .maybeSingle();
      if (data?.status === "passed" && !validateDateOfBirth(data.date_of_birth).isValid) {
        return "review";
      }
      return (data?.status as AgeVerificationStatus) ?? "none";
    },
  });
}

/**
 * True when the event needs verification AND this viewer is actually in scope
 * for it.
 *
 * `inScope` is the missing half. Without it this asked only "is the event
 * restricted and is this person unverified", which is true for every existing
 * member on every 18+ event, so the entire membership was prompted to scan an
 * ID — on a platform where not one person has ever been verified, and where the
 * capture session currently cannot even be created. A dead-end demand shown to
 * everyone.
 *
 * Who is in scope is not this function's decision. It belongs to
 * verified_admission_policy, which already carries the enforce switch, the
 * cohort cutoff and the grace deadline. Pass the verdict from
 * useVerifiedAdmission(); while enforcement is off, nobody is in scope and the
 * interstitial never opens. Set a cohort and only accounts created after it are
 * asked.
 *
 * ponytail: `inScope` is optional and defaults to NOT in scope. A caller that
 * forgets it shows no prompt rather than prompting everyone — wrong in the
 * direction that does not harass the membership.
 */
export function needsAgeVerification(
  ageRestriction: string | undefined | null,
  status: AgeVerificationStatus | undefined,
  inScope: boolean = false,
): boolean {
  const restricted = ageRestriction === "18+" || ageRestriction === "21+";
  return restricted && status !== "passed" && inScope;
}

/** Starts (or resumes) a Didit session; returns the hosted capture URL. */
export function useStartVerification() {
  const queryClient = useQueryClient();
  const authId = useAuthStore((s) => s.user?.authId);
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
        queryClient.setQueryData([...ageVerificationKeys.status, authId], "passed");
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
