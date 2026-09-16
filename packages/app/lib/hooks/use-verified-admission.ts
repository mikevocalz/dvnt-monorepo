import { useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import {
  decideVerifiedAdmission,
  type AdmissionContext,
  type AdmissionVerdict,
} from "@dvnt/app/lib/auth/verified-admission";

/**
 * Verified-only admission, read from the server.
 *
 * `verified_admission_context()` returns the caller's own inputs — rollout
 * configuration, account age, verification record — taken from the JWT, never
 * from a parameter. The verdict is drawn from those inputs so the banner says
 * what the edge functions will say. The edge functions remain the gate.
 */
export const verifiedAdmissionKeys = {
  verdict: ["verified-admission", "verdict"] as const,
};

const ALLOWED: AdmissionVerdict = {
  state: "allowed",
  reason: "not_enforced",
  deadline: null,
  message: null,
};

export function useVerifiedAdmission() {
  const authId = useAuthStore((s) => s.user?.authId);
  return useQuery({
    queryKey: [...verifiedAdmissionKeys.verdict, authId],
    enabled: !!authId,
    staleTime: 60_000,
    queryFn: async (): Promise<AdmissionVerdict> => {
      const { data, error } = await supabase.rpc("verified_admission_context");
      // ponytail: an unreadable context leaves the UI quiet. It cannot grant
      // anything — the server refuses the action either way — and a banner
      // built on a failed read would be guesswork.
      if (error || !data) return ALLOWED;
      const context = data as AdmissionContext;
      // A context for a different account is never applied to this one.
      if (context.userId !== authId) return ALLOWED;
      return decideVerifiedAdmission(context);
    },
  });
}

interface AdmissionPromptStore {
  /** Auth ids that dismissed the prompt. Memory only: it returns next launch. */
  dismissed: string[];
  dismiss: (authId: string) => void;
}

export const useAdmissionPromptStore = create<AdmissionPromptStore>((set) => ({
  dismissed: [],
  dismiss: (authId) =>
    set((state) => state.dismissed.includes(authId)
      ? state
      : { dismissed: [...state.dismissed, authId] }),
}));
