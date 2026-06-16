/**
 * Global report-sheet store.
 *
 * Any screen can fire `openReportSheet({...})` and a top-level
 * <ReportSheet /> in the root layout will surface the reason picker
 * and dispatch the API call. This keeps the per-screen wiring to a
 * single dispatcher call, no per-screen modal state, no prop drilling.
 *
 * Required by App Store Guideline 1.2 — every UGC surface needs a
 * working report path. The store IS the surface area; the sheet is
 * the UI; the lib/api/reports.ts client is the network call.
 */

import { create } from "zustand";
import type { ReportEntityType } from "@dvnt/app/lib/api/reports";

interface ReportTarget {
  entityType: ReportEntityType;
  entityId: string;
  /** Human-friendly label shown in the sheet header, e.g. "@username". */
  label?: string;
}

interface ReportSheetState {
  visible: boolean;
  target: ReportTarget | null;
  openReportSheet: (target: ReportTarget) => void;
  closeReportSheet: () => void;
}

export const useReportSheetStore = create<ReportSheetState>((set) => ({
  visible: false,
  target: null,
  openReportSheet: (target) => set({ visible: true, target }),
  closeReportSheet: () => set({ visible: false, target: null }),
}));
