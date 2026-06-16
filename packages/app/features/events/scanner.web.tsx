"use client";

/**
 * Event Ticket Scanner — WEB port of the native door scanner
 * (`app/(protected)/events/[id]/scanner.tsx`).
 *
 * Law 1 (data flow is sacred): consumes the EXACT same hooks/mutations as
 * native — `useScanTicket` (→ `ticketsApi.scanTicket` → the `ticket-scan` edge
 * fn) for check-in, `useEvent` for the host-only gate, `useAuthStore` for the
 * scanning operator, and `useOfflineCheckinStore` for the offline fallback
 * (already-scanned / valid-token / invalid). The scan → check-in result branch
 * (valid / already_scanned / not_found / refunded / network error) is ported
 * faithfully, including the running scanned count and recent-scan history.
 *
 * Law 2 (camera): the QR surface is the kit `QrScanner` from `@dvnt/ui`
 * (html5-qrcode on web). `onScan(token)` is wired to the same check-in path
 * native's VisionCamera barcode callback used — same deep-link unwrap
 * (`dvnt://ticket/<token>`), same de-dupe + cooldown, same mutation call.
 *
 * Law 3 (web lists = TanStack Virtual): recent scans render through
 * `@tanstack/react-virtual` over a scroll container — never FlatList /
 * FlashList. Screen state (scan result / count / history) lives in a tiny
 * Zustand store (`useScannerStore`), never useState. Avatars are rounded
 * squares.
 *
 * Law 4 (presentation): raw semantic HTML + Tailwind only (NativeWind interop
 * off). Sticky glass header ("Scanner") like legal-page.web.tsx, content
 * max-w-xl, bg #06070d, accent cyan #3FDCFF, success green, error rose.
 * Navigation via Solito; id via useParams.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "solito/navigation";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { QrScanner } from "@dvnt/ui";
import { useScanTicket } from "@dvnt/app/lib/hooks/use-tickets";
import { useEvent } from "@dvnt/app/lib/hooks/use-events";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useOfflineCheckinStore } from "@dvnt/app/lib/stores/offline-checkin-store";
import { getCurrentUserIdSync } from "@dvnt/app/lib/auth/identity";
import {
  useScannerStore,
  type ScanResult,
  type ScanHistoryEntry,
} from "@dvnt/app/lib/stores/scanner-store";

const ROW_HEIGHT = 44;

// ── ScanResultOverlay ─────────────────────────────────────────────────────────
function ScanResultOverlay({
  result,
  onDismiss,
}: {
  result: ScanResult;
  onDismiss: () => void;
}) {
  const isSuccess = result.type === "success";
  const Icon =
    isSuccess
      ? CheckCircle2
      : result.type === "already_scanned"
        ? AlertTriangle
        : XCircle;
  const bg = isSuccess ? "rgba(34,197,94,0.95)" : "rgba(244,63,94,0.95)";
  const title = isSuccess
    ? "Checked In!"
    : result.type === "already_scanned"
      ? "Already Scanned"
      : result.type === "not_found"
        ? "Invalid Ticket"
        : "Scan Error";

  return (
    <div
      onClick={onDismiss}
      role="button"
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 px-10"
    >
      <div
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl p-8 text-center"
        style={{ backgroundColor: bg }}
      >
        <Icon size={56} color="#fff" strokeWidth={2} />
        <p className="text-[22px] font-bold text-white">{title}</p>
        {result.name ? (
          <p className="text-base font-medium text-white/90">{result.name}</p>
        ) : null}
        {result.tierName ? (
          <p className="text-sm text-white/70">{result.tierName}</p>
        ) : null}
        {result.message ? (
          <p className="text-[13px] text-white/70">{result.message}</p>
        ) : null}
        <p className="mt-2 text-xs text-white/50">Tap anywhere to scan next</p>
      </div>
    </div>
  );
}

// ── RecentScans (TanStack Virtual) ────────────────────────────────────────────
function RecentScans({ history }: { history: ScanHistoryEntry[] }) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: history.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <div
      ref={parentRef}
      className="overflow-y-auto"
      style={{ maxHeight: 280 }}
    >
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vItem) => {
          const entry = history[vItem.index];
          if (!entry) return null;
          const isOk = entry.type === "success";
          const isDup = entry.type === "already_scanned";
          const color = isOk ? "#22C55E" : isDup ? "#FBBF24" : "#F43F5E";
          const label = isOk
            ? entry.name || "Checked In"
            : isDup
              ? "Already Scanned"
              : "Invalid";
          const time = new Date(entry.timestamp).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          });
          return (
            <div
              key={entry.id}
              data-index={vItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${vItem.start}px)`,
              }}
            >
              <div className="flex items-center justify-between gap-2 border-t border-white/8 py-2.5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {/* Rounded-square status chip (avatars are rounded squares). */}
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate text-xs font-medium text-white">
                    {label}
                  </span>
                  {entry.tierName ? (
                    <span className="shrink-0 text-xs text-white/40">
                      · {entry.tierName}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-[10px] text-white/30">
                  {time}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ScannerActive ─────────────────────────────────────────────────────────────
// Rendered only once the host gate passes. Wires the kit QrScanner's onScan to
// the exact native check-in path.
function ScannerActive({ eventId }: { eventId: string }) {
  const authUser = useAuthStore((s) => s.user);
  const scanMutation = useScanTicket();
  const offlineStore = useOfflineCheckinStore();
  const hasOfflineData = offlineStore.hasOfflineData(eventId);

  const scanResult = useScannerStore((s) => s.scanResult);
  const scanCount = useScannerStore((s) => s.scanCount);
  const scanHistory = useScannerStore((s) => s.scanHistory);
  const setScanResult = useScannerStore((s) => s.setScanResult);
  const clearResult = useScannerStore((s) => s.clearResult);
  const recordSuccess = useScannerStore((s) => s.recordSuccess);
  const recordHistory = useScannerStore((s) => s.recordHistory);
  const reset = useScannerStore((s) => s.reset);

  const [manualToken, setManualToken] = useState("");
  const lastScannedRef = useRef<string>("");
  const cooldownRef = useRef(false);

  // Clear transient scan state when leaving the screen.
  useEffect(() => () => reset(), [reset]);

  const handleToken = useCallback(
    (rawValue: string) => {
      if (cooldownRef.current || useScannerStore.getState().scanResult) return;
      if (!rawValue) return;
      if (rawValue === lastScannedRef.current) return;
      lastScannedRef.current = rawValue;
      cooldownRef.current = true;

      let qrToken = rawValue;
      const deepLinkMatch = rawValue.match(/dvnt:\/\/ticket\/(.+)/);
      if (deepLinkMatch) {
        qrToken = deepLinkMatch[1];
      }

      scanMutation.mutate(
        { qrToken, scannedBy: authUser?.id, eventId },
        {
          onSuccess: (data) => {
            if (data.valid) {
              setScanResult({
                type: "success",
                name: data.ticket?.name,
                tierName: data.ticket?.tier_name,
              });
              recordSuccess({
                name: data.ticket?.name,
                tierName: data.ticket?.tier_name,
              });
            } else {
              const isDuplicate = data.reason === "already_scanned";
              const resultType = isDuplicate
                ? ("already_scanned" as const)
                : ("not_found" as const);
              setScanResult({
                type: resultType,
                message: isDuplicate
                  ? "This ticket was already scanned"
                  : data.reason === "refunded"
                    ? "This ticket has been refunded"
                    : "This QR code is not a valid ticket",
              });
              recordHistory(resultType);
            }
          },
          onError: () => {
            if (hasOfflineData) {
              if (offlineStore.isAlreadyScanned(eventId, qrToken)) {
                setScanResult({
                  type: "already_scanned",
                  message: "This ticket was already scanned (offline)",
                });
                recordHistory("already_scanned");
              } else if (offlineStore.isTokenValid(eventId, qrToken)) {
                offlineStore.markScannedOffline(eventId, qrToken, authUser?.id);
                setScanResult({
                  type: "success",
                  name: "Verified Offline",
                  tierName: undefined,
                });
                recordSuccess({ name: "Verified Offline" });
              } else {
                setScanResult({
                  type: "not_found",
                  message: "Not a valid ticket (offline check)",
                });
                recordHistory("not_found");
              }
            } else {
              setScanResult({
                type: "error",
                message: "Network error. Download tickets for offline scanning.",
              });
            }
          },
        },
      );
    },
    [
      scanMutation,
      authUser?.id,
      eventId,
      hasOfflineData,
      offlineStore,
      setScanResult,
      recordSuccess,
      recordHistory,
    ],
  );

  const dismissResult = useCallback(() => {
    clearResult();
    lastScannedRef.current = "";
    cooldownRef.current = false;
  }, [clearResult]);

  const submitManual = useCallback(() => {
    const token = manualToken.trim();
    if (!token) return;
    setManualToken("");
    // Reset de-dupe so a manual token always dispatches.
    lastScannedRef.current = "";
    cooldownRef.current = false;
    handleToken(token);
  }, [manualToken, handleToken]);

  return (
    <main className="relative mx-auto w-full max-w-xl px-4 py-4">
      {/* Camera / QR surface (kit, html5-qrcode on web) */}
      <div className="relative">
        <QrScanner onScan={handleToken} oneShot={false} />
        {/* Scan frame guide. */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="h-60 w-60 rounded-3xl border-2 border-white/40" />
        </div>
        {scanMutation.isPending && !scanResult ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl bg-black/50">
            <Loader2 size={32} className="animate-spin text-white" />
            <span className="text-sm text-white">Validating...</span>
          </div>
        ) : null}
        {scanResult ? (
          <ScanResultOverlay result={scanResult} onDismiss={dismissResult} />
        ) : null}
      </div>

      {/* Manual entry — type / paste a ticket token at the door. */}
      <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2">
        <ScanLine size={16} color="rgba(255,255,255,0.45)" />
        <input
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitManual();
          }}
          placeholder="Enter ticket token manually"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-white placeholder:text-white/35 outline-none"
        />
        <button
          onClick={submitManual}
          disabled={!manualToken.trim() || scanMutation.isPending}
          className="shrink-0 rounded-lg bg-[#3FDCFF] px-3 py-1.5 text-[13px] font-semibold text-black disabled:opacity-40"
        >
          Check in
        </button>
      </div>

      {/* Stats + recent scans */}
      <div className="mt-4 rounded-xl border border-white/8 bg-white/4 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} color="#22C55E" />
            <span className="text-sm font-semibold text-white">
              {scanCount} scanned
            </span>
          </div>
          <span className="text-xs text-white/50">
            {scanHistory.length > 0
              ? `${scanHistory.length} recent`
              : "Point camera at a QR code"}
          </span>
        </div>

        {scanHistory.length > 0 ? (
          <div className="mt-2">
            <RecentScans history={scanHistory} />
          </div>
        ) : null}
      </div>
    </main>
  );
}

// ── EventScannerScreen ────────────────────────────────────────────────────────
export function EventScannerScreen() {
  const params = useParams();
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eventId = String((params as any)?.id ?? "");

  const user = useAuthStore((s) => s.user);
  const { data: event, isLoading: eventLoading } = useEvent(eventId);

  // Host-only gate — same client-side check native runs before exposing the
  // camera surface. The edge fn enforces it server-side too.
  const isHost = useMemo(() => {
    if (!user?.id || !event?.host?.id) return false;
    const hostId = String(event.host.id);
    if (String(user.id) === hostId) return true;
    const intId = getCurrentUserIdSync();
    if (intId != null && String(intId) === hostId) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authId = (user as any)?.authId || (user as any)?.auth_id;
    if (authId && String(authId) === hostId) return true;
    return false;
  }, [user, event]);

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky glass header. */}
      <div
        className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 py-3 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        <span className="w-9" />
        <h1 className="text-[17px] font-semibold">Scanner</h1>
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/8 active:scale-95"
        >
          <X size={18} color="#fff" />
        </button>
      </div>

      {eventLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 size={32} className="animate-spin text-white/60" />
        </div>
      ) : !isHost ? (
        <main className="mx-auto flex w-full max-w-xl flex-col items-center px-8 py-24 text-center">
          <XCircle size={64} color="#F43F5E" />
          <p className="mt-4 text-lg font-semibold text-white">Not authorized</p>
          <p className="mt-2 text-sm text-white/60">
            Only the event host can scan tickets at the door.
          </p>
          <button
            onClick={() => router.back()}
            className="mt-6 rounded-full bg-white/10 px-6 py-3 text-sm font-semibold text-white active:bg-white/15"
          >
            Go Back
          </button>
        </main>
      ) : (
        <ScannerActive eventId={eventId} />
      )}
    </div>
  );
}

export default EventScannerScreen;
