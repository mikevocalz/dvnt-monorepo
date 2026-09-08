/**
 * Purchase-flow state for the native membership paywall (Zustand per store
 * rules — no useState for business state). Deliberately NOT persisted: an
 * in-flight or "activating" purchase must not be resurrected from MMKV after
 * a cold start — on relaunch the DB row (written by the RC webhook) is the
 * truth and useEntitlements reflects it.
 *
 * Lifecycle: idle → purchasing (store sheet up) → activating (store purchase
 * succeeded, waiting for revenuecat-webhook → membership_subscriptions →
 * entitlements refetch) → idle once the plan appears. Restore has its own
 * flag so both buttons can't run concurrently.
 */
import { create } from "zustand";
import type { PlanKey } from "@dvnt/app/lib/subscription";

interface MembershipPurchaseState {
  /** Tier whose store purchase sheet is currently up. */
  purchasingPlanKey: PlanKey | null;
  /** Tier bought on the store; waiting for the webhook-written DB row. */
  activatingPlanKey: PlanKey | null;
  restoring: boolean;
  error: string | null;
  /** Neutral outcome copy — see the sneaky store. A restore that found
   *  nothing is an answer, not a failure. */
  notice: string | null;
  /** Waiting for the RC webhook to land the row useEntitlements reads. */
  restoreSettling: boolean;

  startPurchase: (planKey: PlanKey) => void;
  purchaseSucceeded: (planKey: PlanKey) => void;
  purchaseCancelled: () => void;
  purchaseFailed: (message: string) => void;
  /** Entitlements now show the purchased plan — activation complete. */
  activationConfirmed: () => void;
  setRestoring: (restoring: boolean) => void;
  setNotice: (notice: string | null) => void;
  setRestoreSettling: (settling: boolean) => void;
  clearError: () => void;
}

export const useMembershipPurchaseStore = create<MembershipPurchaseState>()(
  (set) => ({
    purchasingPlanKey: null,
    activatingPlanKey: null,
    restoring: false,
    error: null,
    notice: null,
    restoreSettling: false,

    startPurchase: (planKey) =>
      set({ purchasingPlanKey: planKey, error: null, notice: null }),
    purchaseSucceeded: (planKey) =>
      set({ purchasingPlanKey: null, activatingPlanKey: planKey, error: null }),
    purchaseCancelled: () => set({ purchasingPlanKey: null }),
    purchaseFailed: (message) =>
      set({ purchasingPlanKey: null, error: message }),
    activationConfirmed: () => set({ activatingPlanKey: null }),
    setRestoring: (restoring) => set({ restoring }),
    setNotice: (notice) => set({ notice }),
    setRestoreSettling: (restoreSettling) => set({ restoreSettling }),
    clearError: () => set({ error: null, notice: null }),
  }),
);
