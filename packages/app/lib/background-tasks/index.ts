/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  DVNT BACKGROUND TASKS — opportunistic acceleration (WS-11)         ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * Four opportunistic jobs registered via `expo-task-manager` (defineTask) +
 * `expo-background-task` (registerTaskAsync). They run when the OS grants the
 * app a background window — they are ACCELERATION, never a source of truth.
 *
 * ── HONEST EXECUTION CONSTRAINTS (read before adding a job here) ──────────
 * • Execution is OPPORTUNISTIC. The OS decides when — you request a minimum
 *   interval, you do not get a schedule.
 * • The minimum interval floor is ~15 minutes. `minimumInterval` is a lower
 *   bound the system rounds UP to suit battery/thermal/usage; it is not a timer.
 * • iOS gives NO timing guarantee. In Low Power Mode, with Background App
 *   Refresh off, or for an app the user rarely opens, these jobs may run late,
 *   rarely, or NEVER. A single ~30s (best case a few minutes) window, killable
 *   at any moment (see `addExpirationListener`).
 * • THEREFORE: NO money-critical and NO state-authoritative logic runs here.
 *   Stripe webhooks + foreground sync remain the source of truth; these jobs
 *   only warm caches / drain already-durable queues sooner. The outbox MONEY
 *   LAW (lib/outbox/drain.ts) still applies — checkout/refund/payout never
 *   enqueue, so the background drain can never replay money.
 * • Every job body: small, idempotent, wrapped in try/catch, returns the
 *   module's Success/Failed result. Failure just means "try again next window".
 *
 * PLATFORM: native only. On web, `expo-background-task` reports Restricted and
 * registration is a guarded no-op (the outbox/scan queues already drain on
 * navigator.onLine + AppState while the page is alive).
 *
 * iOS BGTask identifier: all four JS tasks below multiplex under expo's single
 * permitted identifier `com.expo.modules.backgroundtask.processing`, added to
 * Info.plist by the `expo-background-task` config plugin. The strings below are
 * TaskManager JS task names, not iOS BGTask identifiers.
 */

import { Platform } from "react-native";
import * as TaskManager from "expo-task-manager";
import * as BackgroundTask from "expo-background-task";

// ─── Task identifiers (TaskManager JS task names) ───────────────────────────

export const BG_TASK_SCAN_FLUSH = "dvnt.bg.scan-queue-flush";
export const BG_TASK_TICKET_PREFETCH = "dvnt.bg.ticket-freshness-prefetch";
export const BG_TASK_UPLOAD_WATCHDOG = "dvnt.bg.upload-watchdog";
export const BG_TASK_OUTBOX_DRAIN = "dvnt.bg.outbox-drain";

const ALL_TASKS = [
  BG_TASK_SCAN_FLUSH,
  BG_TASK_TICKET_PREFETCH,
  BG_TASK_UPLOAD_WATCHDOG,
  BG_TASK_OUTBOX_DRAIN,
] as const;

// System floor is ~15 min; we pass it explicitly so intent is legible. The OS
// treats it as a minimum and will run less often as it sees fit.
const MINIMUM_INTERVAL_MINUTES = 15;

const { Success, Failed } = BackgroundTask.BackgroundTaskResult;

// ─── Job 1: scan-queue flush (WS-8/WS-12 background path) ────────────────────
// Drain offline-checkin pendingScans via ticketsApi.syncOfflineScans. The
// foreground auto-drain (connectivity→online / AppState foreground) landed in
// WS-12; this is the backgrounded counterpart for when the door device never
// returns to the foreground. Retained-on-failure — unsynced scans stay queued.
TaskManager.defineTask(BG_TASK_SCAN_FLUSH, async () => {
  try {
    const { flushOfflineScansNow } = await import(
      "@dvnt/app/lib/stores/offline-checkin-store"
    );
    await flushOfflineScansNow();
    return Success;
  } catch (e) {
    console.warn("[BGTask] scan-queue-flush failed:", e);
    return Failed;
  }
});

// ─── Job 2: ticket freshness prefetch (WS-8 cold/offline door flow) ──────────
// Refresh the holder's tickets (QR payloads + denormalized event snapshot) into
// the SAME persisted TanStack cache the app hydrates on cold start, so the door
// flow works cold/offline. Non-destructive: restore the existing persisted
// cache first, prefetch tickets on top, save the merged blob back through the
// whitelist-filtering serializer. Requires the "tickets" prefix in the persist
// whitelist (lib/query-persistence.ts) — added alongside this job.
TaskManager.defineTask(BG_TASK_TICKET_PREFETCH, async () => {
  try {
    const [{ QueryClient }, persistClientMod, { queryPersister, persistOptions }, { ticketKeys }, { ticketsApi }] =
      await Promise.all([
        import("@tanstack/react-query"),
        import("@tanstack/react-query-persist-client"),
        import("@dvnt/app/lib/query-persistence"),
        import("@dvnt/app/lib/hooks/use-tickets"),
        import("@dvnt/app/lib/api/tickets"),
      ]);
    const { persistQueryClientRestore, persistQueryClientSave } = persistClientMod;

    const client = new QueryClient();
    // Rehydrate feed/messages/events/etc. so we don't clobber them on save.
    await persistQueryClientRestore({
      queryClient: client,
      persister: queryPersister,
      maxAge: persistOptions.maxAge,
      buster: persistOptions.buster,
    });
    await client.prefetchQuery({
      queryKey: ticketKeys.myTickets(),
      queryFn: () => ticketsApi.getMyTickets(),
    });
    await persistQueryClientSave({
      queryClient: client,
      persister: queryPersister,
      buster: persistOptions.buster,
    });
    client.clear();
    return Success;
  } catch (e) {
    console.warn("[BGTask] ticket-freshness-prefetch failed:", e);
    return Failed;
  }
});

// ─── Job 3: upload watchdog (WS-10) ──────────────────────────────────────────
// Sweep the durable upload-watchdog registry: uploads stuck "uploading" past
// the threshold (their JS context died mid-transfer) flip to "stuck" and are
// surfaced via getStuckUploads() for a foreground "Resume upload" prompt. We do
// NOT re-run compression + multipart upload in this constrained window — heavy
// media work re-drives in the foreground on explicit user action. RN uploads
// are not native background URLSessions; there is nothing for the OS to resume.
TaskManager.defineTask(BG_TASK_UPLOAD_WATCHDOG, async () => {
  try {
    const { sweepStuckUploads } = await import(
      "@dvnt/app/lib/media/upload-watchdog-store"
    );
    const stuck = sweepStuckUploads();
    if (stuck > 0) {
      console.warn(`[BGTask] upload-watchdog: ${stuck} stuck upload(s) surfaced`);
    }
    return Success;
  } catch (e) {
    console.warn("[BGTask] upload-watchdog failed:", e);
    return Failed;
  }
});

// ─── Job 4: outbox drain (WS-12 background path) ─────────────────────────────
// Best-effort completion of queued outbox mutations (like/RSVP/bookmark, never
// money — MONEY LAW is enforced at registration). requestDrain() is the outbox's
// public drain entry and is a no-op while offline; it also fires the shared
// drain listeners (idempotent with job 1's scan flush).
TaskManager.defineTask(BG_TASK_OUTBOX_DRAIN, async () => {
  try {
    const { requestDrain } = await import("@dvnt/app/lib/outbox");
    await requestDrain();
    return Success;
  } catch (e) {
    console.warn("[BGTask] outbox-drain failed:", e);
    return Failed;
  }
});

// ─── Registration lifecycle ──────────────────────────────────────────────────

let _registering = false;

/**
 * Register all four background tasks. Idempotent (skips already-registered
 * tasks) and fully defensive — never throws. Call once the user is
 * authenticated (the jobs need a session); safe to call again on resume.
 * No-op on web and when the OS reports background tasks Restricted (Background
 * App Refresh off, Low Power Mode, parental restriction, etc.).
 */
export async function registerBackgroundTasks(): Promise<void> {
  if (Platform.OS === "web") return;
  if (_registering) return;
  _registering = true;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) {
      console.warn(
        "[BGTask] background tasks Restricted on this device — skipping registration",
      );
      return;
    }
    for (const name of ALL_TASKS) {
      try {
        const already = await TaskManager.isTaskRegisteredAsync(name);
        if (!already) {
          await BackgroundTask.registerTaskAsync(name, {
            minimumInterval: MINIMUM_INTERVAL_MINUTES,
          });
        }
      } catch (e) {
        console.warn(`[BGTask] failed to register ${name}:`, e);
      }
    }
  } catch (e) {
    console.warn("[BGTask] registerBackgroundTasks failed (non-fatal):", e);
  } finally {
    _registering = false;
  }
}

/**
 * Unregister all four background tasks. Defensive — never throws. Call on
 * sign-out so a logged-out device stops waking to hit authed edge functions.
 */
export async function unregisterBackgroundTasks(): Promise<void> {
  if (Platform.OS === "web") return;
  for (const name of ALL_TASKS) {
    try {
      if (await TaskManager.isTaskRegisteredAsync(name)) {
        await BackgroundTask.unregisterTaskAsync(name);
      }
    } catch (e) {
      console.warn(`[BGTask] failed to unregister ${name}:`, e);
    }
  }
}
