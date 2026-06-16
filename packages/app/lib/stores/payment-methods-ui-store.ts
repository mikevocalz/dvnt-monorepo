/**
 * Payment Methods UI Store — web-local view state for the Payment Methods screen.
 *
 * Project rule: never useState on web. All dialog/add-card flags + the in-flight
 * setup-intent client secret live here in Zustand. Data (the methods list /
 * loading / error) stays in the shared `payments-store`; this store only holds
 * ephemeral UI flags for the add-card Dialog, the remove-confirm Dialog, and the
 * per-row "setting default / removing" busy ids.
 */

import { create } from "zustand";
import type { PaymentMethod } from "@dvnt/app/lib/types/payments";

interface PaymentMethodsUIState {
  // Add-card Dialog
  addOpen: boolean;
  isStartingSetup: boolean;
  setupClientSecret: string | null;
  isConfirmingAdd: boolean;
  addError: string | null;

  // Remove-confirm Dialog
  removeTarget: PaymentMethod | null;
  isRemoving: boolean;

  // Per-row busy id for set-default
  settingDefaultId: string | null;

  openAdd: () => void;
  closeAdd: () => void;
  setIsStartingSetup: (v: boolean) => void;
  setSetupClientSecret: (v: string | null) => void;
  setIsConfirmingAdd: (v: boolean) => void;
  setAddError: (v: string | null) => void;

  openRemove: (method: PaymentMethod) => void;
  closeRemove: () => void;
  setIsRemoving: (v: boolean) => void;

  setSettingDefaultId: (v: string | null) => void;
}

export const usePaymentMethodsUIStore = create<PaymentMethodsUIState>((set) => ({
  addOpen: false,
  isStartingSetup: false,
  setupClientSecret: null,
  isConfirmingAdd: false,
  addError: null,

  removeTarget: null,
  isRemoving: false,

  settingDefaultId: null,

  openAdd: () => set({ addOpen: true, addError: null, setupClientSecret: null }),
  closeAdd: () =>
    set({
      addOpen: false,
      isStartingSetup: false,
      setupClientSecret: null,
      isConfirmingAdd: false,
      addError: null,
    }),
  setIsStartingSetup: (isStartingSetup) => set({ isStartingSetup }),
  setSetupClientSecret: (setupClientSecret) => set({ setupClientSecret }),
  setIsConfirmingAdd: (isConfirmingAdd) => set({ isConfirmingAdd }),
  setAddError: (addError) => set({ addError }),

  openRemove: (removeTarget) => set({ removeTarget }),
  closeRemove: () => set({ removeTarget: null, isRemoving: false }),
  setIsRemoving: (isRemoving) => set({ isRemoving }),

  setSettingDefaultId: (settingDefaultId) => set({ settingDefaultId }),
}));
