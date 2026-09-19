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

import { useCallback, useEffect, useMemo, useRef } from "react";
import { DismissOverlayButton } from "@dvnt/app/components/ui/card-link.web";
import { useParams, useRouter } from "solito/navigation";
import { useEventRole } from "@dvnt/app/lib/hooks/use-event-role";
import {
  rememberDoorRole,
  recallDoorRole,
} from "@dvnt/app/lib/events/confirmed-door-role";
import {
  useDoorOfflineKit,
  useDoorSyncStore,
  type DoorSyncPhase,
} from "./door-offline-kit.web";
import { DoorGuestList, useDoorRosterCounts } from "./door-guest-list.web";
import {
  primeDoorAudio,
  signalVerdict,
  useDoorFeedbackStore,
} from "./door-feedback.web";
import { canScanTickets } from "@dvnt/app/lib/events/event-role";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Volume2,
  VolumeX,
  Loader2,
} from "lucide-react";
import { QrScanner } from "@dvnt/ui";
import type { ScanAddonSummary } from "@dvnt/app/lib/api/tickets";
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
import { planAccent, planLabel as planLabelFor } from "@dvnt/app/lib/theme/plan-colors";
import { PERK_LABELS } from "@dvnt/app/lib/perks/perk-config";
import {
  isScanFailure,
  OFFLINE_UNVERIFIED,
  scanVerdictMessage,
  scanVerdictTitle,
} from "@dvnt/app/lib/tickets/scan-verdict";

const ROW_HEIGHT = 44;

// ── AddonRows ─────────────────────────────────────────────────────────────────
// Order add-ons on the scan result card: "VIP table ×1 — unredeemed".
// Qty in mono (the ticket-stub data voice); redeemed state as a quiet chip.
function AddonRows({ addons }: { addons: ScanAddonSummary[] }) {
  if (!addons.length) return null;
  return (
    <div className="mt-1 w-full rounded-xl bg-black/25 p-2 text-left">
      <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/50">
        Add-ons
      </p>
      {addons.map((a) => {
        const redeemed = a.status === "redeemed";
        const refunded = a.status === "refunded";
        const state = refunded
          ? "refunded"
          : redeemed
            ? "redeemed"
            : "unredeemed";
        return (
          <div
            key={a.id}
            className="flex items-center justify-between gap-2 border-t border-white/10 px-1 py-1.5 first-of-type:border-t-0"
          >
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
              {a.name}
              {a.variant_name ? (
                <span className="text-white/60"> · {a.variant_name}</span>
              ) : null}
              <span className="font-mono text-white/80"> ×{a.quantity}</span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                refunded
                  ? "bg-black/40 text-white/50 line-through"
                  : redeemed
                    ? "bg-black/40 text-white/60"
                    : "bg-white text-black"
              }`}
            >
              {state}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── DuplicateFlash ────────────────────────────────────────────────────────────
// LOUD full-viewport duplicate flag. Paints instantly (optimistic when the
// offline store already knows the token) — the red flash + huge ORIGINAL scan
// time are the point. Honors prefers-reduced-motion (static red, no strobe).
function DuplicateFlash({
  result,
  onDismiss,
}: {
  result: ScanResult;
  onDismiss: () => void;
}) {
  const scannedAt = result.checkedInAt ? new Date(result.checkedInAt) : null;
  const timeLabel = scannedAt
    ? scannedAt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;
  const dateLabel = scannedAt
    ? scannedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div
      aria-live="assertive"
      // Carries the same marker as the standard card. A duplicate takes this
      // separate full-viewport treatment rather than the card, so without it
      // the most COMMON rejection is the one path nothing can assert on.
      data-verdict="rejected"
      className="dvnt-dup-flash fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 px-8 text-center"
      style={{ backgroundColor: "#FC253A" }}
    >
      {/* The panel is a live region announcing a door result, not a control.
          It used to be `role="button"`, which made a screen reader read the
          whole result — icon, heading, check-in facts — as one button, and
          gave no keyboard way to dismiss it. */}
      <DismissOverlayButton onPress={onDismiss} label="Dismiss scan result" />
      <style>{`
        @keyframes dvnt-dup-flash {
          0% { opacity: 0.35; }
          25% { opacity: 1; }
          45% { opacity: 0.55; }
          70% { opacity: 1; }
          100% { opacity: 1; }
        }
        .dvnt-dup-flash {
          animation: dvnt-dup-flash 280ms cubic-bezier(0.22, 1, 0.36, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .dvnt-dup-flash { animation: none; }
        }
      `}</style>
      <AlertTriangle size={64} color="#fff" strokeWidth={2.5} />
      <p className="text-[28px] font-bold uppercase tracking-[0.08em] text-white">
        Already scanned
      </p>
      {/* The instruction the big red word does not give. A door person who
          reads only "already scanned" still has to decide what to DO, and the
          answer is not "turn them away" — it is "get the host", because a
          double-scan is as often a staff mistake as a guest's. */}
      <p className="text-[15px] font-semibold text-white">
        Don&rsquo;t let them in yet — get the host.
      </p>
      {result.kind === "addon" && result.name ? (
        <p className="text-base font-semibold text-white/95">{result.name}</p>
      ) : null}
      {timeLabel ? (
        <p className="font-mono text-[40px] font-bold leading-none text-white">
          {timeLabel}
        </p>
      ) : null}
      {dateLabel || result.checkedInByName ? (
        <p className="text-[15px] font-medium text-white/90">
          {dateLabel}
          {result.checkedInByName ? ` · by ${result.checkedInByName}` : ""}
        </p>
      ) : null}
      {!timeLabel && result.message ? (
        <p className="text-[15px] text-white/90">{result.message}</p>
      ) : null}
      {result.optimistic ? (
        <p className="text-xs font-medium uppercase tracking-wide text-white/70">
          Confirming with server…
        </p>
      ) : null}
      {result.addons?.length ? (
        <div className="w-full max-w-sm">
          <AddonRows addons={result.addons} />
        </div>
      ) : null}
      <p className="mt-2 text-xs text-white/70">Tap anywhere to scan next</p>
    </div>
  );
}

// ── ScanResultOverlay ─────────────────────────────────────────────────────────
function ScanResultOverlay({
  result,
  onDismiss,
  fixed = false,
}: {
  result: ScanResult;
  onDismiss: () => void;
  /**
   * Position against the viewport instead of the camera frame.
   *
   * In guest-list mode there IS no camera frame — its container is `hidden`,
   * so an `absolute inset-0` card had nothing to size against and painted
   * nowhere. Staff checked a guest in from the list, saw no verdict, and
   * because `dismissResult` is the only thing that clears the scan latch,
   * every later tap was a silent no-op.
   */
  fixed?: boolean;
}) {
  // Duplicates get the loud full-viewport treatment.
  if (result.type === "already_scanned") {
    return <DuplicateFlash result={result} onDismiss={onDismiss} />;
  }

  const isSuccess = result.type === "success";
  // Amber = "no verdict, rescan"; red is reserved for a ticket the SERVER rejected.
  // Amber is dark-on-light, and that is a correctness fix rather than taste:
  // white on mid-amber (#D97706) measures ~3.0:1 and fails AA for body text
  // outright — the verdict most likely to be misread was the least readable.
  // #78350F on #FEF3C7 is ~10:1 and still reads as a colour field at arm's
  // length, which a dark brown would not (05-a11y.md).
  const noVerdict = result.type === "error";
  const bg = isSuccess
    ? "rgba(34,197,94,0.95)"
    : noVerdict
      ? "#FEF3C7"
      : "rgba(244,63,94,0.95)";
  const fg = noVerdict ? "#78350F" : "#FFFFFF";
  // A third glyph, not a reused one. Colour + word + icon must each carry the
  // verdict alone, and ✕ on both a rejection and a no-verdict left the icon
  // saying nothing.
  const Icon = isSuccess ? CheckCircle2 : noVerdict ? AlertTriangle : XCircle;
  // Title, colour and icon all derive from the SAME outcome, so the card
  // cannot say one thing in words and another in colour.
  const outcome: "success" | "rejected" | "no_verdict" = isSuccess
    ? "success"
    : result.type === "error"
      ? "no_verdict"
      : "rejected";
  const title = scanVerdictTitle(outcome, result.reason, result.kind);

  return (
    <div
      className={`${fixed ? "fixed" : "absolute"} inset-0 z-50 flex items-center justify-center bg-black/70 px-10`}
    >
      <DismissOverlayButton onPress={onDismiss} label="Dismiss scan result" />
      {/* The card announces itself. 05-a11y.md: an admitted verdict is polite
          so it does not interrupt a scanner mid-flow, while a rejection and a
          no-verdict are assertive because acting on a missed one means letting
          the wrong person through. The accessible name is the title, so the
          outcome is the first thing read — and it gives the card an identity
          the recent-scans list below it does not share. */}
      <div
        role={outcome === "success" ? "status" : "alert"}
        aria-label={title}
        // The card and the recent-scans list below it both render the same
        // verdict words, so "is this string on the page" cannot tell them
        // apart. This names the card itself.
        data-verdict={outcome}
        className="flex w-full max-w-sm flex-col items-center gap-3 rounded-3xl p-8 text-center"
        style={{ backgroundColor: bg }}
      >
        <Icon size={56} color={fg} strokeWidth={2} />
        <p className="text-[22px] font-bold" style={{ color: fg }}>
          {title}
        </p>
        {result.name ? (
          <p className="text-base font-medium" style={{ color: fg, opacity: 0.92 }}>
            {result.name}
          </p>
        ) : null}
        {result.tierName ? (
          <p className="text-sm" style={{ color: fg, opacity: 0.75 }}>
            {result.tierName}
          </p>
        ) : null}
        {/* WS-4 — subscription tier + perks, sized to be read at a door in the
            dark at arm's length. Deliberately louder than the ticket tier above
            it: this is what tells staff to move someone to the front. */}
        {result.planLabel ? (
          <span
            className="rounded-xl px-4 py-1.5 text-[17px] font-extrabold uppercase tracking-wide"
            style={{
              backgroundColor: `${result.planColor ?? "#fff"}26`,
              color: result.planColor ?? "#fff",
            }}
          >
            {result.planLabel}
          </span>
        ) : null}
        {result.perkLabels?.length ? (
          <p className="text-[15px] font-semibold text-white">
            {result.perkLabels.join(" · ")}
          </p>
        ) : null}
        {result.message ? (
          // The sentence that says the ticket was NOT checked. On the amber
          // card this was the least readable text on screen and the most
          // important — at 13px, white on mid-amber is nowhere near AA.
          <p className="text-[13px]" style={{ color: fg, opacity: 0.85 }}>
            {result.message}
          </p>
        ) : null}
        {result.addons?.length ? <AddonRows addons={result.addons} /> : null}
        <p className="mt-2 text-xs" style={{ color: fg, opacity: 0.6 }}>
          Tap anywhere to scan next
        </p>
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
  const { queued } = useDoorOfflineKit(eventId);

  // Same roster query the guest list reads, so the two can never disagree
  // about how many people are still outside.
  const roster = useDoorRosterCounts(eventId);
  const syncPhase = useDoorSyncStore((s) => s.phase);
  const listUpdatedAt = useDoorSyncStore((s) => s.listUpdatedAt);

  const scanResult = useScannerStore((s) => s.scanResult);
  const scanCount = useScannerStore((s) => s.scanCount);
  const soundOn = useDoorFeedbackStore((s) => s.soundOn);
  const setSoundOn = useDoorFeedbackStore((s) => s.setSoundOn);

  /**
   * Sound and vibration follow the rendered verdict rather than being fired
   * from each mutation branch — one place the outcome is known for certain is
   * one place it can be signalled, and an optimistic duplicate that the server
   * later overturns does not get to buzz twice for different reasons.
   */
  const lastSignalled = useRef<string | null>(null);
  useEffect(() => {
    if (!scanResult) {
      lastSignalled.current = null;
      return;
    }
    const key = `${scanResult.type}:${scanResult.optimistic ? "o" : "s"}`;
    if (lastSignalled.current === key) return;
    lastSignalled.current = key;
    signalVerdict(
      scanResult.type === "success"
        ? "admitted"
        : scanResult.type === "error"
          ? "no_verdict"
          : "rejected",
    );
  }, [scanResult]);
  const scanHistory = useScannerStore((s) => s.scanHistory);
  const setScanResult = useScannerStore((s) => s.setScanResult);
  const scannerError = useScannerStore((st) => st.scannerError);
  const setScannerError = useScannerStore((st) => st.setScannerError);
  const legacyEngine =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("engine") === "legacy";
  const clearResult = useScannerStore((s) => s.clearResult);
  const recordSuccess = useScannerStore((s) => s.recordSuccess);
  const recordHistory = useScannerStore((s) => s.recordHistory);
  const reset = useScannerStore((s) => s.reset);

  const manualToken = useScannerStore((s) => s.manualToken);
  const setManualToken = useScannerStore((s) => s.setManualToken);
  const lastScannedRef = useRef<string>("");
  const cooldownRef = useRef(false);

  const mode = useScannerStore((s) => s.mode);
  const setModeRaw = useScannerStore((s) => s.setMode);

  /**
   * Changing surface dismisses the verdict.
   *
   * The card belongs to the camera and is hidden in list mode, but
   * `handleToken` refuses to submit while a scanResult exists — so an
   * invisible card left armed made every "Check in" in the list do nothing at
   * all, with no error and no feedback. Clearing it on the way over is the fix:
   * a verdict the staffer can no longer see is one they have finished with.
   */
  const setMode = useCallback(
    (next: "scan" | "list") => {
      clearResult();
      lastScannedRef.current = "";
      cooldownRef.current = false;
      setModeRaw(next);
    },
    [clearResult, setModeRaw],
  );

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

      // ── <300ms duplicate first paint ──────────────────────────────
      // If this device already knows the token was scanned (offline set
      // or a prior online success), flip the loud duplicate UI NOW from
      // local knowledge; the server confirmation (with the ORIGINAL
      // checked_in_at/by) follows and replaces it. Server always wins.
      const knownDuplicate = offlineStore.isAlreadyScanned(eventId, qrToken);
      if (knownDuplicate) {
        setScanResult({
          type: "already_scanned",
          optimistic: true,
          reason: "already_scanned",
          message: "This ticket was already scanned on this device",
        });
        recordHistory("already_scanned");
      }

      scanMutation.mutate(
        { qrToken, scannedBy: authUser?.id, eventId },
        {
          onSuccess: (data) => {
            if (data.valid) {
              const isAddon = data.kind === "addon";
              const name = isAddon
                ? [data.addon?.name, data.addon?.variant_name]
                    .filter(Boolean)
                    .join(" · ")
                : data.ticket?.name;
              const tierName = isAddon
                ? `Add-on ×${data.addon?.quantity ?? 1}`
                : data.ticket?.tier_name;
              const planKey = data.membership_tier?.planKey ?? null;
              setScanResult({
                type: "success",
                kind: data.kind ?? "ticket",
                name,
                tierName,
                addons: data.addons,
                // `free` gets no badge — only a paid tier is worth door attention.
                planLabel:
                  planKey && planKey !== "free" ? planLabelFor(planKey) : null,
                planColor: planAccent(planKey),
                perkLabels: (data.perks ?? []).map((p) => PERK_LABELS[p]),
              });
              recordSuccess({ kind: data.kind ?? "ticket", name, tierName });
              // Seed local knowledge so a re-scan flips instantly.
              offlineStore.markScannedLocal(eventId, qrToken);
            } else {
              const isDuplicate = data.reason === "already_scanned";
              // "We could not ask" (dead session / 403 / 429 / 5xx) is NOT a
              // verdict on the ticket — scanVerdictTitle renders a "Not checked in"
              // title, never one that calls the ticket invalid.
              const isFailure = isScanFailure(data.reason);
              const resultType = isDuplicate
                ? ("already_scanned" as const)
                : isFailure
                  ? ("error" as const)
                  : ("not_found" as const);
              setScanResult({
                type: resultType,
                kind: data.kind ?? "ticket",
                name:
                  data.kind === "addon" && data.addon
                    ? [data.addon.name, data.addon.variant_name]
                        .filter(Boolean)
                        .join(" · ")
                    : undefined,
                // Server truth: the ORIGINAL check-in facts.
                checkedInAt: data.checked_in_at ?? null,
                checkedInByName: data.checked_in_by_name ?? null,
                addons: data.addons,
                optimistic: false,
                reason: data.reason ?? null,
                message: scanVerdictMessage(data.reason),
              });
              if (isDuplicate) {
                offlineStore.markScannedLocal(eventId, qrToken);
              }
              // Optimistic paint already logged this duplicate; a failure is
              // not a verdict, so it never enters the door log as "Invalid".
              if (!isFailure && !(isDuplicate && knownDuplicate)) {
                recordHistory(resultType);
              }
            }
          },
          onError: () => {
            // Network down — the optimistic duplicate verdict stands.
            if (knownDuplicate) return;
            if (hasOfflineData) {
              if (offlineStore.isAlreadyScanned(eventId, qrToken)) {
                setScanResult({
                  type: "already_scanned",
                  optimistic: true,
                  reason: "already_scanned",
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
              } else if (offlineStore.isAddonTokenValid(eventId, qrToken)) {
                // Add-on rail — queue with the kind discriminator.
                offlineStore.markScannedOffline(
                  eventId,
                  qrToken,
                  authUser?.id,
                  "addon",
                );
                setScanResult({
                  type: "success",
                  kind: "addon",
                  name: "Add-on Verified Offline",
                });
                recordSuccess({ kind: "addon", name: "Add-on Verified Offline" });
              } else {
                // Amber, NOT red. The downloaded list is active tickets as of
                // the last refresh, and it is frozen for as long as this phone
                // is offline — so a ticket sold at the door is missing from it
                // through no fault of the holder. Calling that "not a valid
                // ticket" is a refusal the server never made, and it turns a
                // paying guest away on the strength of a stale cache.
                setScanResult({
                  type: "error",
                  reason: OFFLINE_UNVERIFIED,
                  message: scanVerdictMessage(OFFLINE_UNVERIFIED),
                });
                recordHistory("error");
              }
            } else {
              setScanResult({
                type: "error",
                reason: "network_error",
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
      {roster.total > 0 ? (
        <div className="mt-1">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-semibold text-white">
              {roster.checkedIn} in
            </span>
            <span className="text-white/55">
              {roster.total - roster.checkedIn} still outside
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={roster.total}
            aria-valuenow={roster.checkedIn}
            aria-label="Guests checked in"
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
          >
            <div
              className="h-full rounded-full bg-[#22C55E]"
              style={{ width: `${Math.round((roster.checkedIn / roster.total) * 100)}%` }}
            />
          </div>
        </div>
      ) : null}

      {/* List | Scan on ONE surface. Two routes would mean two check-in paths
          and a staffer navigating while someone waits. */}
      <div
        role="group"
        aria-label="Door mode"
        className="mt-1 flex gap-2"
        onPointerDown={primeDoorAudio}
      >
        <button
          type="button"
          aria-pressed={mode === "scan"}
          onClick={() => setMode("scan")}
          className={`h-11 flex-1 rounded-xl text-[14px] font-semibold ${
            mode === "scan" ? "bg-white text-black" : "border border-white/15 text-white/75"
          }`}
        >
          Scan
        </button>
        <button
          type="button"
          aria-pressed={mode === "list"}
          onClick={() => setMode("list")}
          className={`h-11 flex-1 rounded-xl text-[14px] font-semibold ${
            mode === "list" ? "bg-white text-black" : "border border-white/15 text-white/75"
          }`}
        >
          Guest list
        </button>
        <button
          type="button"
          aria-pressed={soundOn}
          aria-label={soundOn ? "Turn scan sound off" : "Turn scan sound on"}
          onClick={() => {
            primeDoorAudio();
            setSoundOn(!soundOn);
          }}
          className={`h-11 w-11 shrink-0 rounded-xl text-[13px] font-semibold ${
            soundOn ? "bg-white/15 text-white" : "border border-white/15 text-white/50"
          }`}
        >
          {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </div>

      {/* Camera / QR surface — the kit QrScanner, expo-camera's CameraView. */}
      <div className={mode === "scan" ? "relative mt-3" : "hidden"}>
        {/* `paused` stops the decode loop while a verdict is up. Without it the
            card from the previous guest is still on screen while the NEXT
            guest's code is already being decoded behind it — the stale-card
            failure, and the most dangerous one per guest. The camera itself
            stays live, so resuming costs nothing. */}
        {/* Paused for BOTH reasons, and the second one is not cosmetic: in list
            mode the camera is only `hidden`, so it stays mounted and keeps
            decoding. It re-read the code in frame, re-armed handleToken's
            guard, and swallowed the guest list's "Check in" — intermittently,
            depending on whether a decode landed before the tap. */}
        <QrScanner
          onScan={handleToken}
          oneShot={false}
          paused={mode !== "scan" || !!scanResult}
          // The legacy engine has no issue panel of its own — its ONLY error
          // channel is this callback, and it was never passed. Staff hitting a
          // camera error, tapping the "Switch scanner engine" button the UI
          // recommends, and landing somewhere that reports nothing is the one
          // failure this screen cannot have, because it is the escape hatch
          // from every other failure. The modern engine renders its own panel
          // and calls this too; a second channel costs nothing.
          onError={(message) => setScannerError(message)}
        />
        {scannerError && legacyEngine ? (
          <div
            role="alert"
            className="absolute inset-x-3 bottom-3 rounded-xl bg-[#FEF3C7] px-3 py-2.5 text-[13px] font-semibold text-[#78350F]"
          >
            {scannerError} Typed codes still work below.
          </div>
        ) : null}
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
        {scanResult && mode === "scan" ? (
          <ScanResultOverlay result={scanResult} onDismiss={dismissResult} />
        ) : null}
      </div>

      {mode === "list" ? (
        <DoorGuestList
          eventId={eventId}
          onCheckIn={handleToken}
          checkingInToken={scanMutation.isPending ? lastScannedRef.current : null}
        />
      ) : null}

      {/* The same verdict, against the viewport, because the camera frame it
          normally sizes against is `hidden` in this mode. Rendered here rather
          than inside that container so the list keeps its own layout and the
          card still covers it — a verdict staff can walk past is the one
          failure this screen cannot have. */}
      {scanResult && mode === "list" ? (
        <ScanResultOverlay result={scanResult} onDismiss={dismissResult} fixed />
      ) : null}

      <DoorSyncRow phase={syncPhase} queued={queued} listUpdatedAt={listUpdatedAt} />

      {/* Manual entry — type / paste a ticket token at the door. Scan mode
          only: in list mode the list IS the fallback. */}
      <div
        className={
          mode === "scan"
            ? "mt-4 flex items-center gap-2 rounded-xl bg-white/6 px-3 py-2"
            : "hidden"
        }
      >
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

/**
 * One shape for all three gate outcomes, so a volunteer reads the same layout
 * whichever wall they hit: what happened, what to do, who they are, and which
 * door this is.
 *
 * `identity` is the load-bearing line. Nine times in ten the volunteer is
 * signed into a personal account and the host added a different one — without
 * the address on screen that is undiagnosable, and they blame the app.
 *
 * `tone` is never the only signal: each panel carries an icon and a first word
 * as well, because this is read in the dark on cracked screens (05-a11y.md).
 * Amber here is dark-on-light, not white-on-amber, which fails AA outright.
 */
function GatePanel({
  tone,
  title,
  body,
  action,
  secondary,
  identity,
  hostName,
}: {
  tone: "warn" | "deny";
  title: string;
  body: string;
  action: { label: string; onPress: () => void };
  secondary?: { label: string; onPress: () => void };
  identity?: string | null;
  hostName?: string | null;
}) {
  const Icon = tone === "deny" ? XCircle : AlertTriangle;
  return (
    <main
      role="alert"
      className="mx-auto flex w-full max-w-xl flex-col items-center px-8 py-16 text-center"
    >
      <span
        className={
          tone === "deny"
            ? "flex h-16 w-16 items-center justify-center rounded-2xl bg-[#F43F5E]/15"
            : "flex h-16 w-16 items-center justify-center rounded-2xl bg-[#FEF3C7]"
        }
      >
        <Icon size={36} color={tone === "deny" ? "#F43F5E" : "#78350F"} />
      </span>

      <h2 className="mt-5 text-[20px] font-semibold leading-snug text-white">
        {title}
      </h2>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-white/70">
        {body}
      </p>

      <button
        type="button"
        onClick={action.onPress}
        className="mt-6 h-12 min-w-[180px] rounded-xl bg-white px-6 text-[15px] font-semibold text-black active:scale-95"
      >
        {action.label}
      </button>
      {secondary ? (
        <button
          type="button"
          onClick={secondary.onPress}
          className="mt-3 h-12 rounded-xl px-5 text-[14px] font-semibold text-white/75 underline underline-offset-4 active:text-white"
        >
          {secondary.label}
        </button>
      ) : null}

      {identity || hostName ? (
        <div className="mt-8 space-y-1 text-[13px] text-white/45">
          {identity ? <p>Signed in as {identity}</p> : null}
          {hostName ? <p>Door: {hostName}</p> : null}
        </div>
      ) : null}
    </main>
  );
}

/**
 * What the door's connection is doing, in one line it can ignore.
 *
 * Deliberately not an alert and never a blocker: scanning works in every one
 * of these states, and a row that shouts would train staff to dismiss it. It
 * is `role="status"` so a screen reader hears the change without losing focus
 * (05-a11y.md, 4.1.3), and each phase carries a word plus a dot rather than a
 * colour alone.
 */
function DoorSyncRow({ phase, queued, listUpdatedAt }: {
  phase: DoorSyncPhase;
  queued: number;
  listUpdatedAt: number | null;
}) {
  const minutesAgo =
    listUpdatedAt === null ? null : Math.floor((Date.now() - listUpdatedAt) / 60_000);

  const { dot, text } =
    phase === "offline"
      ? {
          dot: "bg-[#F59E0B]",
          text:
            queued > 0
              ? `Offline — ${queued} ${queued === 1 ? "scan" : "scans"} queued`
              : "Offline — scans will queue until signal returns",
        }
      : phase === "syncing"
        ? { dot: "bg-[#3FDCFF]", text: "Syncing…" }
        : phase === "synced"
          ? { dot: "bg-[#22C55E]", text: "Synced" }
          : {
              dot: "bg-[#22C55E]",
              text:
                minutesAgo === null
                  ? "Online"
                  : minutesAgo < 1
                    ? "Online · list updated just now"
                    : `Online · list updated ${minutesAgo} min ago`,
            };

  return (
    <p
      role="status"
      className="mt-3 flex items-center gap-2 text-[12px] text-white/55"
    >
      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      {text}
    </p>
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

  /**
   * Staff gate, from the server's role ladder rather than event ownership.
   * The owner-only comparison this replaces refused the scanner screen to
   * anyone given the `scanner` role — the people it exists for.
   */
  const { role, isLoading: roleLoading, isError: roleError, refetch: refetchRole } =
    useEventRole(eventId);
  const isAuthenticated = useAuthStore((st) => st.isAuthenticated);
  const hasHydrated = useAuthStore((st) => st._hasHydrated);
  const offlineStore = useOfflineCheckinStore();

  // A confirmed role is remembered so a phone that has already been told it is
  // staff can still open the door when the venue's signal drops.
  useEffect(() => {
    if (!roleError && !roleLoading && role) rememberDoorRole(eventId, role);
  }, [role, roleError, roleLoading, eventId]);

  /**
   * Three different problems used to render one "Not authorized", which sends
   * a volunteer to argue with the host about a dead session, or to stand in a
   * basement believing they were removed from the door.
   *
   *   signed_out    — no session at all. Fix: sign in again.
   *   not_staff     — the server answered, and the answer was no.
   *   cannot_verify — we never got an answer. Says nothing about the staffer.
   *
   * Only `not_staff` is a refusal. `cannot_verify` falls through to offline
   * mode when this device has BOTH a remembered role and downloaded tokens —
   * remembering a role you were granted is not granting yourself one, and a
   * device that has never been confirmed for this event still does not get in.
   */
  const remembered = recallDoorRole(eventId);
  const canOpenOffline = !!remembered && offlineStore.hasOfflineData(eventId);
  const gate: "loading" | "signed_out" | "not_staff" | "cannot_verify" | "open" =
    !hasHydrated || eventLoading || roleLoading
      ? "loading"
      : !isAuthenticated
        ? "signed_out"
        : canScanTickets(role)
          ? "open"
          : roleError
            ? canOpenOffline
              ? "open"
              : "cannot_verify"
            : "not_staff";

  return (
    <div className="min-h-[100dvh] bg-[#06070d] text-white">
      {/* Sticky glass header. */}
      <div
        // Clearance as a class, not an inline style: an inline paddingTop beats
        // every Tailwind variant, so the notch inset was also pinning desktop
        // to 12px and the title sat flush against the viewport edge. The
        // safe-area term still carries the notch on a phone; md+ just gets room.
        className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/8 bg-[#06070d]/85 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] backdrop-blur md:pt-[calc(env(safe-area-inset-top)+28px)] md:pb-5"
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

      {gate === "loading" ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Loader2 size={32} className="animate-spin text-white/60" />
        </div>
      ) : gate === "signed_out" ? (
        <GatePanel
          tone="warn"
          title="You&rsquo;ve been signed out"
          body="Sign in again to keep scanning. Nothing you already scanned was lost."
          action={{
            label: "Sign in",
            // Back to this exact door after signing in, not to the feed.
            onPress: () =>
              router.push(
                `/auth/login?next=${encodeURIComponent(
                  typeof window !== "undefined"
                    ? window.location.pathname + window.location.search
                    : `/feed/events/${eventId}/scanner`,
                )}`,
              ),
          }}
          identity={user?.email ?? null}
          hostName={event?.title ?? null}
        />
      ) : gate === "cannot_verify" ? (
        <GatePanel
          tone="warn"
          title="Can&rsquo;t check your access offline"
          body="We can&rsquo;t confirm you&rsquo;re door staff without signal. Get signal, then tap Try again."
          action={{ label: "Try again", onPress: () => void refetchRole() }}
          identity={user?.email ?? null}
          hostName={event?.title ?? null}
        />
      ) : gate === "not_staff" ? (
        <GatePanel
          tone="deny"
          title="You&rsquo;re not on door staff for this event"
          body={
            user?.email
              ? `Ask the host to add ${user.email}, then reload this page.`
              : "Ask the host to add your account, then reload this page."
          }
          action={{
            label: "Reload",
            onPress: () =>
              typeof window !== "undefined" ? window.location.reload() : undefined,
          }}
          secondary={{ label: "Sign in as someone else", onPress: () => router.push("/auth/login") }}
          identity={user?.email ?? null}
          hostName={event?.title ?? null}
        />
      ) : (
        <ScannerActive eventId={eventId} />
      )}
    </div>
  );
}

export default EventScannerScreen;
