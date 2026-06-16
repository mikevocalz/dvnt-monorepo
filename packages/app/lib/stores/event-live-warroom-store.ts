import { create } from "zustand"

/**
 * Event War Room (Live) — screen-local state (web).
 *
 * Project rule: screen-local state lives in Zustand, never useState. The native
 * `app/(protected)/events/[id]/live.tsx` holds sold / scanned / refunded
 * counters, the rolling 30-minute scans-per-minute buckets, the last-20 live
 * check-in feed, the connection flag, and a loading flag in component state.
 * This store mirrors that exact shape so the web port can reproduce the
 * realtime rollup + feed logic without useState. None of this changes the
 * server contract — it only relocates the same state.
 */

export const BUCKET_COUNT = 30 // 30 minutes

export interface ScanRow {
  id: string
  checked_in_at: string
  ticket_type_name?: string
  qr_token?: string
}

interface WarRoomState {
  eventTitle: string | null
  sold: number
  scannedCount: number
  refunded: number
  recent: ScanRow[]
  /** Per-minute scan count rolling over the last 30 minutes. */
  buckets: number[]
  connected: boolean
  loading: boolean
  /** Effective role from the tickets edge fn — owner/admin/editor/scanner. */
  role: "owner" | "admin" | "editor" | "scanner" | null
  permissionDenied: boolean

  setEventTitle: (title: string | null) => void
  setSold: (updater: number | ((c: number) => number)) => void
  setScannedCount: (updater: number | ((c: number) => number)) => void
  setRefunded: (updater: number | ((c: number) => number)) => void
  setRecent: (updater: ScanRow[] | ((prev: ScanRow[]) => ScanRow[])) => void
  setBuckets: (updater: number[] | ((prev: number[]) => number[])) => void
  setConnected: (connected: boolean) => void
  setLoading: (loading: boolean) => void
  setRole: (role: WarRoomState["role"]) => void
  setPermissionDenied: (denied: boolean) => void
  reset: () => void
}

const initialState = {
  eventTitle: null as string | null,
  sold: 0,
  scannedCount: 0,
  refunded: 0,
  recent: [] as ScanRow[],
  buckets: Array<number>(BUCKET_COUNT).fill(0),
  connected: false,
  loading: true,
  role: null as WarRoomState["role"],
  permissionDenied: false,
}

export const useEventLiveWarRoomStore = create<WarRoomState>((set) => ({
  ...initialState,
  setEventTitle: (eventTitle) => set({ eventTitle }),
  setSold: (updater) =>
    set((s) => ({
      sold: typeof updater === "function" ? updater(s.sold) : updater,
    })),
  setScannedCount: (updater) =>
    set((s) => ({
      scannedCount:
        typeof updater === "function" ? updater(s.scannedCount) : updater,
    })),
  setRefunded: (updater) =>
    set((s) => ({
      refunded: typeof updater === "function" ? updater(s.refunded) : updater,
    })),
  setRecent: (updater) =>
    set((s) => ({
      recent: typeof updater === "function" ? updater(s.recent) : updater,
    })),
  setBuckets: (updater) =>
    set((s) => ({
      buckets: typeof updater === "function" ? updater(s.buckets) : updater,
    })),
  setConnected: (connected) => set({ connected }),
  setLoading: (loading) => set({ loading }),
  setRole: (role) => set({ role }),
  setPermissionDenied: (permissionDenied) => set({ permissionDenied }),
  reset: () => set({ ...initialState, buckets: Array<number>(BUCKET_COUNT).fill(0) }),
}))
