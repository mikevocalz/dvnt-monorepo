/**
 * Purchase-flow state for the native Sneaky Lynk IAP paywall
 * (SneakySubscriptionModal). Sibling of the membership paywall's
 * membership-purchase-store — kept separate so a Sneaky purchase mid-flight
 * never collides with a membership purchase's activation watch.
 *
 * Zustand per store rules — no useState for business state. Deliberately NOT
 * persisted: an in-flight or "activating" purchase must not be resurrected
 * from MMKV after a cold start — on relaunch the DB row (written by the RC
 * webhook) is the truth and useEntitlements reflects it.
 *
 * Lifecycle: idle → purchasing (store sheet up) → activating (store purchase
 * succeeded, waiting for revenuecat-webhook → membership_subscriptions →
 * entitlements refetch) → idle once the plan appears. Restore has its own
 * flag so both buttons can't run concurrently.
 */
import { create } from "zustand";
import type { PlanKey } from "@dvnt/app/lib/subscription";

interface SneakyPurchaseState {
  /** Tier whose store purchase sheet is currently up. */
  purchasingPlanKey: PlanKey | null;
  /** Tier bought on the store; waiting for the webhook-written DB row. */
  activatingPlanKey: PlanKey | null;
  restoring: boolean;
  error: string | null;

  startPurchase: (planKey: PlanKey) => void;
  purchaseSucceeded: (planKey: PlanKey) => void;
  purchaseCancelled: () => void;
  purchaseFailed: (message: string) => void;
  /** Entitlements now show the purchased plan — activation complete. */
  activationConfirmed: () => void;
  setRestoring: (restoring: boolean) => void;
  clearError: () => void;
}

export const useSneakyPurchaseStore = create<SneakyPurchaseState>()((set) => ({
  purchasingPlanKey: null,
  activatingPlanKey: null,
  restoring: false,
  error: null,

  startPurchase: (planKey) => set({ purchasingPlanKey: planKey, error: null }),
  purchaseSucceeded: (planKey) =>
    set({ purchasingPlanKey: null, activatingPlanKey: planKey, error: null }),
  purchaseCancelled: () => set({ purchasingPlanKey: null }),
  purchaseFailed: (message) =>
    set({ purchasingPlanKey: null, error: message }),
  activationConfirmed: () => set({ activatingPlanKey: null }),
  setRestoring: (restoring) => set({ restoring }),
  clearError: () => set({ error: null }),
}));
