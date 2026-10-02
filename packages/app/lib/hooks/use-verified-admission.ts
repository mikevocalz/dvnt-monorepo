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
 * what the edge functions will say. The edge functions remain the gate for
 * writes; `useAdultAdmissionGate` below is the gate for the app shell.
 *
 * This read fails CLOSED. A network error, a renamed RPC or a blocked POST
 * leaves the query in `isError` and the caller holds the gate. There is no
 * server read-gate behind it — `verified_participation_allowed()` is attached
 * FOR INSERT only — so an unreadable context must never resolve to "allowed".
 */
export const verifiedAdmissionKeys = {
  verdict: ["verified-admission", "verdict"] as const,
};

/**
 * The verdict for "we could not establish that this account is an admitted
 * adult". Carries the generic `verification_required` reason so the gate shows
 * the verify and sign-out actions, with a message that says what happened
 * rather than asserting a verification state we did not read.
 */
const DENIED: AdmissionVerdict = {
  state: "blocked",
  reason: "verification_required",
  deadline: null,
  message:
    "We could not confirm your age verification. Check your connection and try again, or verify with ID.",
};

export function useVerifiedAdmission() {
  const authId = useAuthStore((s) => s.user?.authId);
  return useQuery({
    queryKey: [...verifiedAdmissionKeys.verdict, authId],
    enabled: !!authId,
    staleTime: 60_000,
    retry: 2,
    queryFn: async (): Promise<AdmissionVerdict> => {
      const { data, error } = await supabase.rpc("verified_admission_context");
      // Throw rather than return a verdict: a failed read is not an answer,
      // and `isError` is what the gate reads to stay closed.
      if (error) {
        throw new Error(error.message || "verified_admission_context failed");
      }
      if (!data) return DENIED;
      const context = data as AdmissionContext;
      // A context for a different account is never applied to this one.
      if (context.userId !== authId) return DENIED;
      return decideVerifiedAdmission(context);
    },
  });
}

export type AdultAdmissionGate =
  /** Auth or the admission read has not answered yet. Mount nothing. */
  | { status: "pending" }
  /** No account to admit. The caller's own sign-in redirect takes over. */
  | { status: "signedOut" }
  /** Show `AdultPlatformGate` with this verdict. Never the app shell. */
  | { status: "blocked"; verdict: AdmissionVerdict }
  /** An authenticated account the server admitted. */
  | { status: "admitted" };

/**
 * The platform admission boundary, shared by the native and web protected
 * layouts so the two cannot drift.
 *
 * Reading `isLoading` here was the hole: in query-core 5.x `isLoading` is
 * `isPending && isFetching`, so a query disabled by `enabled: !!authId` reports
 * `isLoading === false` with `data === undefined`, and `data?.state ===
 * "blocked"` is false. On every cold start before auth hydrated, that mounted
 * the adult app shell. Resolution is therefore taken from auth itself, and only
 * `data` with a non-blocked verdict admits anyone.
 */
export function useAdultAdmissionGate(): AdultAdmissionGate {
  const authId = useAuthStore((s) => s.user?.authId);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const authStatus = useAuthStore((s) => s.authStatus);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);
  const { data, isPending, isError } = useVerifiedAdmission();

  // Nothing is known until the persisted store is back.
  if (!hasHydrated) return { status: "pending" };

  if (!authId) {
    // Native resolves the session through `loadAuthState`, which moves
    // `authStatus` off "loading". The web app never calls it, so a reload
    // there has only the rehydrated store to go on.
    if (isAuthenticated && authStatus === "loading") return { status: "pending" };
    // Signed in with no auth id: the context cannot be read for this account,
    // so it is not admitted. Showing the gate keeps a way out of the state.
    if (isAuthenticated) return { status: "blocked", verdict: DENIED };
    return { status: "signedOut" };
  }

  if (isPending) return { status: "pending" };
  if (isError || !data) return { status: "blocked", verdict: DENIED };
  if (data.state === "blocked") return { status: "blocked", verdict: data };
  return { status: "admitted" };
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
