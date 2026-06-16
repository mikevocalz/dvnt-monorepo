import { create } from "zustand";
import type { PublicGateReason } from "@dvnt/app/lib/access/public-gates";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";

interface PublicGateStore {
  reason: PublicGateReason | null;
  openGate: (reason: PublicGateReason) => void;
  closeGate: () => void;
}

export const usePublicGateStore = create<PublicGateStore>((set) => ({
  reason: null,
  openGate: (reason) => {
    AppTrace.warn("PUBLIC_GATE", "opened", { reason });
    set({ reason });
  },
  closeGate: () => {
    AppTrace.trace("PUBLIC_GATE", "closed");
    set({ reason: null });
  },
}));
