import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { storage } from "@dvnt/app/lib/utils/storage";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { onboardingCheckpoint } from "@dvnt/observability/flows";

/**
 * Onboarding v2 state (PROMPT NN · B2). Persisted Zustand, mirrored to the
 * server-side `onboarding_state` row (account-keyed) so progress survives
 * devices and reinstalls. The one-nudge-per-session cap is enforced HERE,
 * not by convention.
 */

export type OnboardingStepStatus = "done" | "skipped";

interface OnboardingV2State {
  /** The step to resume at (expo-router/Next route-compatible name). */
  currentStep: string | null;
  steps: Record<string, OnboardingStepStatus>;
  /** Epoch ms of the last nudge shown (persisted, for pacing across sessions). */
  lastNudgeAt: number | null;
  /** True once a nudge fired THIS app session (in-memory cap). */
  _nudgedThisSession: boolean;
  _hasHydrated: boolean;

  setCurrentStep: (step: string | null) => void;
  markStep: (step: string, status: OnboardingStepStatus) => void;
  /** The B2 cap: returns true at most once per app session. */
  requestNudge: () => boolean;
  /** Push local state to the server mirror (best-effort, RLS own-row). */
  syncToServer: () => Promise<void>;
  /** Pull the server mirror (call after sign-in; server wins on conflicts). */
  hydrateFromServer: () => Promise<void>;
  reset: () => void;
}

export const useOnboardingV2Store = create<OnboardingV2State>()(
  persist(
    (set, get) => ({
      currentStep: null,
      steps: {},
      lastNudgeAt: null,
      _nudgedThisSession: false,
      _hasHydrated: false,

      setCurrentStep: (currentStep) => {
        set({ currentStep });
        void get().syncToServer();
      },

      markStep: (step, status) => {
        set((s) => ({ steps: { ...s.steps, [step]: status } }));
        onboardingCheckpoint(`${step}.${status}`);
        void get().syncToServer();
      },

      requestNudge: () => {
        if (get()._nudgedThisSession) return false;
        set({ _nudgedThisSession: true, lastNudgeAt: Date.now() });
        onboardingCheckpoint("nudge.shown");
        return true;
      },

      syncToServer: async () => {
        const authId = useAuthStore.getState().user?.authId;
        if (!authId) return;
        const { currentStep, steps } = get();
        try {
          await supabase.from("onboarding_state").upsert(
            {
              auth_id: authId,
              current_step: currentStep,
              state: { steps },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "auth_id" },
          );
        } catch (error) {
          // Best-effort mirror — never block the flow on the network.
          console.warn("[OnboardingV2] server sync failed:", error);
        }
      },

      hydrateFromServer: async () => {
        const authId = useAuthStore.getState().user?.authId;
        if (!authId) return;
        try {
          const { data } = await supabase
            .from("onboarding_state")
            .select("current_step, state")
            .eq("auth_id", authId)
            .maybeSingle();
          if (data) {
            set({
              currentStep: data.current_step ?? null,
              steps: (data.state?.steps as Record<string, OnboardingStepStatus>) ?? {},
            });
          }
        } catch (error) {
          console.warn("[OnboardingV2] server hydrate failed:", error);
        }
      },

      reset: () =>
        set({ currentStep: null, steps: {}, lastNudgeAt: null, _nudgedThisSession: false }),
    }),
    {
      name: "onboarding-v2",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({
        currentStep: s.currentStep,
        steps: s.steps,
        lastNudgeAt: s.lastNudgeAt,
      }),
      onRehydrateStorage: () => (state) => {
        state?._hasHydrated === false && (state._hasHydrated = true);
      },
    },
  ),
);

// ─── Profile completion (B2 ring/checklist math) ────────────────────────────

export interface CompletionItem {
  key: string;
  label: string;
  /** Route to jump to (web paths; native maps its own). */
  route: string;
  weight: number;
  done: boolean;
}

/**
 * Weighted completion from the authed user. Photo dominates — it's the
 * highest-value missing item at events ("so people recognize you").
 */
export function computeProfileCompletion(user: {
  avatar?: string;
  bio?: string;
  sexuality?: string[];
  eventAudience?: string;
  location?: string;
  links?: string[];
} | null): { percent: number; missing: CompletionItem[] } {
  if (!user) return { percent: 0, missing: [] };
  const items: CompletionItem[] = [
    { key: "photo", label: "Add a photo so people recognize you at events", route: "/feed/profile/edit", weight: 30, done: !!user.avatar },
    { key: "bio", label: "Write a short bio", route: "/feed/profile/edit", weight: 20, done: !!user.bio?.trim() },
    { key: "identity", label: "Tell us who you are (private)", route: "/feed/profile/edit", weight: 20, done: (user.sexuality?.length ?? 0) > 0 },
    { key: "audience", label: "Pick who you want events with", route: "/feed/profile/edit", weight: 10, done: !!user.eventAudience },
    { key: "location", label: "Add your city", route: "/feed/profile/edit", weight: 10, done: !!user.location?.trim() },
    { key: "links", label: "Add a link", route: "/feed/profile/edit", weight: 10, done: (user.links?.length ?? 0) > 0 },
  ];
  const percent = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);
  return { percent, missing: items.filter((i) => !i.done).sort((a, b) => b.weight - a.weight) };
}
