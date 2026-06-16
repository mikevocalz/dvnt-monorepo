import { create } from "zustand"

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
  name?: string
  tierName?: string
  message?: string
}

export interface ScanHistoryEntry {
  id: string
  type: ScanResultType
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
