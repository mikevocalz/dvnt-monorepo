/**
 * Tiny UI/data Zustand store for the WEB Sneaky Lynk billing screen.
 *
 * The native screen used local `useState` for these — the HARD CONVENTION on
 * web is Zustand only (no useState). The subscription row is fetched from the
 * SAME `sneaky_subscriptions` Supabase query native uses; this store just holds
 * the result + the loading / dialog flags.
 */

import { create } from "zustand";

export interface SneakySubscription {
  plan_id: string;
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
  grace_period_ends_at: string | null;
}

interface SneakyBillingStore {
  subscription: SneakySubscription | null;
  isLoading: boolean;
  isPortalLoading: boolean;
  showUpgradeModal: boolean;
  /** Plan id currently mid-checkout (drives the per-plan spinner). */
  checkoutPlanId: string | null;
  setSubscription: (s: SneakySubscription | null) => void;
  setIsLoading: (v: boolean) => void;
  setIsPortalLoading: (v: boolean) => void;
  setShowUpgradeModal: (v: boolean) => void;
  setCheckoutPlanId: (v: string | null) => void;
}

export const useSneakyBillingStore = create<SneakyBillingStore>((set) => ({
  subscription: null,
  isLoading: true,
  isPortalLoading: false,
  showUpgradeModal: false,
  checkoutPlanId: null,
  setSubscription: (subscription) => set({ subscription }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setIsPortalLoading: (isPortalLoading) => set({ isPortalLoading }),
  setShowUpgradeModal: (showUpgradeModal) => set({ showUpgradeModal }),
  setCheckoutPlanId: (checkoutPlanId) => set({ checkoutPlanId }),
}));
