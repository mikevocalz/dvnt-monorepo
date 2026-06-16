/**
 * OTA Diagnostics — DVNT
 *
 * Captures a comprehensive snapshot of OTA/build/device/session state
 * for debugging, crash reporting, and the debug-ota screen.
 *
 * Persisted to MMKV so diagnostics survive crash/relaunch.
 * All access is defensive — this module MUST NOT crash the app.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { getUpdateSafetyDiagnostics } from "./updateSafety";
import { getBootDiagnostics } from "@/lib/boot-guard";
import { mmkv as diagStorage } from "@/lib/mmkv-zustand";

function safeGet<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OtaDiagnosticsSnapshot {
  // Identity
  capturedAt: string;
  appVersion: string;
  buildNumber: string;
  bundleId: string;

  // Runtime
  expoSdkVersion: string;
  reactNativeVersion: string;
  jsEngine: string;
  platform: string;
  osVersion: string;
  deviceModel: string;

  // OTA state
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string | null;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  createdAt: string | null;
  projectId: string | null;

  // Safety state
  crashedOnPendingUpdate: boolean;
  pendingUpdateIdAtBoot: string | null;
  badUpdateIds: string[];
  lastConfirmedUpdateId: string | null;

  // Boot state
  safeMode: boolean;
  consecutiveFailedBoots: number;
  lastBootCompletedAt: number | null;

  // Session state
  sessionStartedAt: string;
  lastSuccessfulLaunchAt: string | null;
}

// ── Expo Updates access ───────────────────────────────────────────────────────

let Updates: typeof import("expo-updates") | null = null;
try {
  if (Platform.OS !== "web") {
    Updates = require("expo-updates");
  }
} catch { /* non-fatal */ }

// ── Capture ───────────────────────────────────────────────────────────────────

const SESSION_START = new Date().toISOString();

export function captureOtaDiagnostics(): OtaDiagnosticsSnapshot {
  const safety  = safeGet(() => getUpdateSafetyDiagnostics(), {
    crashedOnPendingUpdate: false,
    pendingUpdateIdAtBoot: null,
    badUpdateIds: [],
    lastConfirmedUpdateId: null,
    lastConfirmedAt: null,
  });

  const boot = safeGet(() => getBootDiagnostics(), {
    safeMode: false,
    consecutiveFailedBoots: 0,
    bootCompleted: false,
    lifetimeSafeModeCount: 0,
    lastLaunchStartedAt: 0,
    lastBootCompletedAt: 0,
  });

  const snapshot: OtaDiagnosticsSnapshot = {
    capturedAt: new Date().toISOString(),

    // App identity
    appVersion: safeGet(() => Constants.expoConfig?.version ?? "unknown", "unknown"),
    buildNumber: safeGet(
      () => (Platform.OS === "ios"
        ? (Constants.expoConfig?.ios as any)?.buildNumber
        : (Constants.expoConfig?.android as any)?.versionCode)?.toString() ?? "unknown",
      "unknown"
    ),
    bundleId: safeGet(
      () => (Platform.OS === "ios"
        ? (Constants.expoConfig?.ios as any)?.bundleIdentifier
        : (Constants.expoConfig?.android as any)?.package) ?? "unknown",
      "unknown"
    ),

    // Runtime
    expoSdkVersion: safeGet(
      () => (Constants.expoConfig as any)?.sdkVersion ?? Constants.expoVersion ?? "unknown",
      "unknown"
    ),
    reactNativeVersion: safeGet(
      () => require("react-native/package.json").version ?? "unknown",
      "unknown"
    ),
    jsEngine: safeGet(() => (globalThis as any).HermesInternal ? "Hermes" : "JSC", "unknown"),
    platform: Platform.OS,
    osVersion: safeGet(() => String(Platform.Version), "unknown"),
    deviceModel: safeGet(() => Constants.deviceName ?? "unknown", "unknown"),

    // OTA state
    isEnabled:           safeGet(() => Updates?.isEnabled ?? false, false),
    isEmbeddedLaunch:    safeGet(() => Updates?.isEmbeddedLaunch ?? true, true),
    isEmergencyLaunch:   safeGet(() => !!Updates?.emergencyLaunchReason, false),
    emergencyLaunchReason: safeGet(() => Updates?.emergencyLaunchReason ?? null, null),
    updateId:            safeGet(() => Updates?.updateId ?? null, null),
    channel:             safeGet(() => Updates?.channel ?? null, null),
    runtimeVersion:      safeGet(() => Updates?.runtimeVersion ?? null, null),
    createdAt:           safeGet(() => {
      const d = Updates?.createdAt;
      return d ? new Date(d).toISOString() : null;
    }, null),
    projectId: safeGet(
      () => Constants.expoConfig?.extra?.eas?.projectId ?? null,
      null
    ),

    // Safety
    crashedOnPendingUpdate: safety.crashedOnPendingUpdate,
    pendingUpdateIdAtBoot:  safety.pendingUpdateIdAtBoot,
    badUpdateIds:           safety.badUpdateIds,
    lastConfirmedUpdateId:  safety.lastConfirmedUpdateId,

    // Boot
    safeMode:                 boot.safeMode,
    consecutiveFailedBoots:   boot.consecutiveFailedBoots,
    lastBootCompletedAt:      boot.lastBootCompletedAt || null,

    // Session
    sessionStartedAt: SESSION_START,
    lastSuccessfulLaunchAt: safeGet(
      () => diagStorage?.getString("__otadiag__last_successful_launch") ?? null,
      null
    ),
  };

  // Persist the snapshot
  try {
    diagStorage?.set("__otadiag__last_diagnostics", JSON.stringify(snapshot));
    if (!safety.crashedOnPendingUpdate) {
      diagStorage?.set("__otadiag__last_successful_launch", SESSION_START);
    }
  } catch { /* non-fatal */ }

  return snapshot;
}

/**
 * Read the last persisted diagnostics snapshot (from a prior session).
 * Useful for post-crash analysis.
 */
export function getLastPersistedDiagnostics(): OtaDiagnosticsSnapshot | null {
  try {
    const raw = diagStorage?.getString("__otadiag__last_diagnostics");
    if (!raw) return null;
    return JSON.parse(raw) as OtaDiagnosticsSnapshot;
  } catch {
    return null;
  }
}

/**
 * Log a full diagnostics snapshot to the console.
 * Called from _layout.tsx after boot completes.
 */
export function logDiagnostics(snapshot: OtaDiagnosticsSnapshot): void {
  console.log("[OtaDiag] ========== OTA DIAGNOSTICS ==========");
  console.log("[OtaDiag] updateId:          ", snapshot.updateId ?? "(embedded)");
  console.log("[OtaDiag] channel:           ", snapshot.channel);
  console.log("[OtaDiag] runtimeVersion:    ", snapshot.runtimeVersion);
  console.log("[OtaDiag] isEmbeddedLaunch:  ", snapshot.isEmbeddedLaunch);
  console.log("[OtaDiag] isEmergencyLaunch: ", snapshot.isEmergencyLaunch);
  console.log("[OtaDiag] safeMode:          ", snapshot.safeMode);
  console.log("[OtaDiag] crashedOnPending:  ", snapshot.crashedOnPendingUpdate);
  console.log("[OtaDiag] badUpdateIds:      ", snapshot.badUpdateIds);
  console.log("[OtaDiag] appVersion:        ", snapshot.appVersion, "build", snapshot.buildNumber);
  console.log("[OtaDiag] jsEngine:          ", snapshot.jsEngine);
  console.log("[OtaDiag] platform:          ", snapshot.platform, snapshot.osVersion);
  if (snapshot.emergencyLaunchReason) {
    console.error("[OtaDiag] EMERGENCY REASON:  ", snapshot.emergencyLaunchReason);
  }
  console.log("[OtaDiag] ==========================================");
}
