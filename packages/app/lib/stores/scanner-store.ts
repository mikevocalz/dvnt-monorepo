import { create } from "zustand"
import type { ScanAddonSummary } from "@dvnt/app/lib/api/tickets"

/**
 * Ticket scanner UI state (web). Project rule: screen-local UI state lives in
 * Zustand, never useState. Mirrors the native scanner screen's local state:
 * the current scan-result overlay, the running scanned count, and the recent
 * scan history list. The data path (scan / check-in mutation) is untouched —
 * this store only holds the transient result + history that native kept in
 * component state.
 */

export type ScanResultType = "success" | "error" | "already_scanned" | "not_found"

export interface ScanResult {
  type: ScanResultType
  /** "addon" when the scanned QR was an order_addons redemption. */
  kind?: "ticket" | "addon"
  name?: string
  tierName?: string
  message?: string
  /** Order add-ons shown on the result card ("VIP table ×1 — unredeemed"). */
  addons?: ScanAddonSummary[]
  /** already_scanned: the ORIGINAL check-in facts from the server CAS. */
  checkedInAt?: string | null
  checkedInByName?: string | null
  /**
   * True while the duplicate verdict comes from LOCAL knowledge only
   * (offline store's already-scanned set) — the <300ms first paint.
   * Server confirmation replaces the result with optimistic: false.
   */
  optimistic?: boolean
}

export interface ScanHistoryEntry {
  id: string
  type: ScanResultType
  kind?: "ticket" | "addon"
  name?: string
  tierName?: string
  timestamp: number
}

interface ScannerState {
  scanResult: ScanResult | null
  scanCount: number
  scanHistory: ScanHistoryEntry[]
  setScanResult: (result: ScanResult | null) => void
  clearResult: () => void
  recordSuccess: (entry: Omit<ScanHistoryEntry, "id" | "type" | "timestamp">) => void
  recordHistory: (type: ScanResultType) => void
  reset: () => void
}

export const useScannerStore = create<ScannerState>((set) => ({
  scanResult: null,
  scanCount: 0,
  scanHistory: [],
  setScanResult: (scanResult) => set({ scanResult }),
  clearResult: () => set({ scanResult: null }),
  recordSuccess: (entry) =>
    set((s) => ({
      scanCount: s.scanCount + 1,
      scanHistory: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "success" as const,
          kind: entry.kind,
          name: entry.name,
          tierName: entry.tierName,
          timestamp: Date.now(),
        },
        ...s.scanHistory,
      ].slice(0, 50),
    })),
  recordHistory: (type) =>
    set((s) => ({
      scanHistory: [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type,
          timestamp: Date.now(),
        },
        ...s.scanHistory,
      ].slice(0, 50),
    })),
  reset: () => set({ scanResult: null, scanCount: 0, scanHistory: [] }),
}))
