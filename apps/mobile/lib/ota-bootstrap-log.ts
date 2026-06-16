/**
 * OTA Bootstrap Logger
 *
 * Runs at module initialization time — before any component renders — so
 * crashes that happen during root component setup still emit update state
 * to the console. Import this as the FIRST side-effect import in _layout.tsx.
 *
 * All expo-updates access is defensive. This module MUST NOT throw.
 *
 * Canary marker — 2026-05-21 cross-cutting events/stories/boost fix bundle.
 */

import { Platform } from "react-native";

function safeGet<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

(function bootstrapOtaLog() {
  try {
    if (Platform.OS === "web") return;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = safeGet(() => require("expo-updates"), null);
    if (!Updates) {
      console.log("[OTA-BOOT] expo-updates unavailable (Expo Go / web)");
      return;
    }

    const isEnabled        = safeGet(() => Updates.isEnabled,            false);
    const isEmbedded       = safeGet(() => Updates.isEmbeddedLaunch,     true);
    const updateId         = safeGet(() => Updates.updateId,             null);
    const channel          = safeGet(() => Updates.channel,              null);
    const runtimeVersion   = safeGet(() => Updates.runtimeVersion,       null);
    const emergency        = safeGet(() => Updates.emergencyLaunchReason, null);
    const createdAt        = safeGet(() => {
      const d = Updates.createdAt;
      return d ? new Date(d).toISOString() : null;
    }, null);

    console.log("[OTA-BOOT] ========== LAUNCH ==========");
    console.log("[OTA-BOOT] isEnabled:            ", isEnabled);
    console.log("[OTA-BOOT] isEmbeddedLaunch:     ", isEmbedded);
    console.log("[OTA-BOOT] updateId:             ", updateId ?? "(none — embedded)");
    console.log("[OTA-BOOT] channel:              ", channel);
    console.log("[OTA-BOOT] runtimeVersion:       ", runtimeVersion);
    console.log("[OTA-BOOT] createdAt:            ", createdAt);
    console.log("[OTA-BOOT] emergencyLaunchReason:", emergency ?? "(none)");

    // P0 HARDENING: emergencyLaunchReason means expo-updates triggered its own
    // error recovery and launched via the emergency path. Log prominently so it
    // appears at the top of device logs regardless of log level filtering.
    if (emergency) {
      console.error("╔══════════════════════════════════════════════════╗");
      console.error("║  [OTA-BOOT] ⚠️  EMERGENCY LAUNCH DETECTED        ║");
      console.error("╚══════════════════════════════════════════════════╝");
      console.error("[OTA-BOOT] EMERGENCY REASON:", emergency);
      console.error("[OTA-BOOT] updateId at emergency launch:", updateId ?? "(embedded)");
      console.error("[OTA-BOOT] isEmbeddedLaunch at emergency launch:", isEmbedded);
    }

    if (isEmbedded) {
      console.warn("[OTA-BOOT] Running embedded (binary) bundle — no OTA applied");
    }

    // Read prior-session crash log written by ErrorRecovery.writeErrorOrExceptionToLog().
    // This survives across launches (persisted to disk). If present it means the PREVIOUS
    // launch triggered error recovery — log the reason so it's visible in this session's logs.
    // readLogEntriesAsync is async, so fire-and-forget to keep the IIFE synchronous.
    const readPromise: Promise<unknown> = safeGet(
      () => Updates.readLogEntriesAsync?.(120_000) ?? Promise.resolve([]),
      Promise.resolve([]),
    );
    readPromise.then((logEntries: unknown) => {
      try {
        if (!Array.isArray(logEntries) || logEntries.length === 0) return;
        const recoveryEntries = logEntries.filter((e: { message?: string }) =>
          e?.message?.includes("EmbeddedFallback") ||
          e?.message?.includes("errorRecoveryCrashing") ||
          e?.message?.includes("errorRecoveryFatalException")
        );
        if (recoveryEntries.length > 0) {
          console.error("╔══════════════════════════════════════════════════╗");
          console.error("║  [OTA-BOOT] ⚠️  PRIOR SESSION ERROR RECOVERY    ║");
          console.error("╚══════════════════════════════════════════════════╝");
          recoveryEntries.forEach((e: { message?: string; timestamp?: number }) => {
            console.error("[OTA-BOOT] PRIOR CRASH LOG:", e?.message, "ts:", e?.timestamp);
          });
        }
      } catch {
        // non-fatal
      }
    }).catch(() => {
      // readLogEntriesAsync not available in all builds — non-fatal
    });

    console.log("[OTA-BOOT] ================================"); // canary-285
  } catch (e) {
    // Swallow all — this logger must never crash the app
    console.warn("[OTA-BOOT] Bootstrap log error (non-fatal):", e);
  }
})();
