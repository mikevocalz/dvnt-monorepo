import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  decideAdultPlatformEntry,
  decideVerifiedAdmission,
  type AdmissionContext,
  type AdmissionVerdict,
} from "@dvnt/app/lib/auth/verified-admission";

export const verifiedAdmissionKeys = {
  verdict: ["verified-admission", "verdict"] as const,
  platformEntry: ["verified-admission", "platform-entry"] as const,
};

const ALLOWED: AdmissionVerdict = {
  state: "allowed",
  reason: "not_enforced",
  deadline: null,
  message: null,
};

const DENIED: AdmissionVerdict = {
  state: "blocked",
  reason: "verification_required",
  deadline: null,
  message:
    "We could not confirm an approved adult ID for this account. Complete verification before entering DVNT.",
};

/**
 * Feature-level admission. This continues to mirror the rollout policy used by
 * server write rails. It is intentionally separate from platform entry.
 */
export function useVerifiedAdmission() {
  const authId = useAuthStore((s) => s.user?.authId);
  return useQuery({
    queryKey: [...verifiedAdmissionKeys.verdict, authId],
    enabled: !!authId,
    staleTime: 60_000,
    queryFn: async (): Promise<AdmissionVerdict> => {
      const { data, error } = await supabase.rpc("verified_admission_context");
      if (error || !data) return ALLOWED;
      const context = data as AdmissionContext;
      if (context.userId !== authId) return ALLOWED;
      return decideVerifiedAdmission(context);
    },
  });
}

/**
 * Platform entry is fail-closed and does not consult policy.enforce.
 * A Better Auth session is not a DVNT admission credential.
 */
function useAdultPlatformEntry() {
  const authId = useAuthStore((s) => s.user?.authId);
  return useQuery({
    queryKey: [...verifiedAdmissionKeys.platformEntry, authId],
    enabled: !!authId,
    staleTime: 15_000,
    retry: 2,
    queryFn: async (): Promise<AdmissionVerdict> => {
      const { data, error } = await supabase.rpc("verified_admission_context");
      if (error) throw new Error(error.message || "verified_admission_context failed");
      if (!data) return DENIED;
      const context = data as AdmissionContext;
      if (context.userId !== authId) return DENIED;
      return decideAdultPlatformEntry(context);
    },
  });
}

export type AdultAdmissionGate =
  | { status: "pending" }
  | { status: "signedOut" }
  | { status: "blocked"; verdict: AdmissionVerdict }
  | { status: "admitted" };

export function useAdultAdmissionGate(): AdultAdmissionGate {
  const authId = useAuthStore((s) => s.user?.authId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authStatus = useAuthStore((s) => s.authStatus);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const { data, isPending, isError } = useAdultPlatformEntry();

  if (!hasHydrated) return { status: "pending" };

  if (!authId) {
    if (isAuthenticated && authStatus === "loading") return { status: "pending" };
    if (isAuthenticated) return { status: "blocked", verdict: DENIED };
    return { status: "signedOut" };
  }

  if (isPending) return { status: "pending" };
  if (isError || !data) return { status: "blocked", verdict: DENIED };
  if (data.state !== "allowed") return { status: "blocked", verdict: data };
  return { status: "admitted" };
}

interface AdmissionPromptStore {
  dismissed: string[];
  dismiss: (authId: string) => void;
}

export const useAdmissionPromptStore = create<AdmissionPromptStore>((set) => ({
  dismissed: [],
  dismiss: (authId) =>
    set((state) =>
      state.dismissed.includes(authId)
        ? state
        : { dismissed: [...state.dismissed, authId] },
    ),
}));
