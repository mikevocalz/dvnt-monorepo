/**
 * OTA Diagnostics Screen
 *
 * Internal QA panel for expo-updates state. Shows exactly what bundle
 * is running, whether it is embedded or downloaded, emergency launch reason,
 * last check/fetch results, and channel/runtime metadata.
 *
 * Access: /(protected)/debug-ota
 *
 * This screen is always rendered — it does not crash if expo-updates is
 * unavailable (Expo Go, simulator without OTA). All expo-updates access is
 * wrapped in safeGet helpers.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Platform,
  Clipboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ChevronLeft, RefreshCw, Copy, AlertTriangle, CheckCircle, XCircle } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";

// ── Safe expo-updates access ──────────────────────────────────────────────────

let Updates: typeof import("expo-updates") | null = null;
try {
  if (Platform.OS !== "web") {
    Updates = require("expo-updates");
  }
} catch {}

function safeGet<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface OtaSnapshot {
  capturedAt: string;
  // Static (set at build/launch time)
  isEnabled: boolean;
  isEmbeddedLaunch: boolean;
  emergencyLaunchReason: string | null;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  createdAt: string | null;
  // Dynamic (from check/fetch)
  checkResult: string | null;
  fetchResult: string | null;
  checkError: string | null;
  fetchError: string | null;
  isChecking: boolean;
  isFetching: boolean;
  // Env
  appVersion: string;
  appEnv: string;
}

function getStaticSnapshot(): Omit<OtaSnapshot, "checkResult" | "fetchResult" | "checkError" | "fetchError" | "isChecking" | "isFetching" | "capturedAt"> {
  const appJson = safeGet(() => require("@dvnt/app/package.json"), {} as any);
  return {
    isEnabled: safeGet(() => Updates?.isEnabled ?? false, false),
    isEmbeddedLaunch: safeGet(() => Updates?.isEmbeddedLaunch ?? true, true),
    emergencyLaunchReason: safeGet(() => (Updates as any)?.emergencyLaunchReason ?? null, null),
    updateId: safeGet(() => Updates?.updateId ?? null, null),
    channel: safeGet(() => Updates?.channel ?? null, null),
    runtimeVersion: safeGet(() => Updates?.runtimeVersion ?? null, null),
    createdAt: safeGet(() => {
      const d = (Updates as any)?.createdAt;
      return d ? new Date(d).toISOString() : null;
    }, null),
    appVersion: appJson.version ?? "unknown",
    appEnv: process.env.APP_ENV ?? process.env.EXPO_PUBLIC_APP_ENV ?? "unknown",
  };
}

// ── Row component ─────────────────────────────────────────────────────────────

function Row({ label, value, mono = false, danger = false, good = false }: {
  label: string;
  value: string | null;
  mono?: boolean;
  danger?: boolean;
  good?: boolean;
}) {
  const { colors } = useColorScheme();
  const valueColor = danger ? "#FF453A" : good ? "#30D158" : colors.mutedForeground;
  return (
    <View style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.06)", gap: 12, flexWrap: "wrap" }}>
      <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", width: 180 }}>{label}</Text>
      <Text
        selectable
        style={{ color: valueColor, fontSize: 13, fontFamily: mono ? "Courier" : undefined, flex: 1 }}
        numberOfLines={3}
      >
        {value ?? "—"}
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  const { colors } = useColorScheme();
  return (
    <Text style={{ color: colors.mutedForeground, fontSize: 11, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", marginTop: 20, marginBottom: 4 }}>
      {title}
    </Text>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function OtaDiagnosticsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useColorScheme();

  const [snapshot, setSnapshot] = useState<OtaSnapshot>(() => ({
    capturedAt: new Date().toISOString(),
    ...getStaticSnapshot(),
    checkResult: null,
    fetchResult: null,
    checkError: null,
    fetchError: null,
    isChecking: false,
    isFetching: false,
  }));

  // Log to console on mount so crash logs capture this even if UI doesn't render
  useEffect(() => {
    const s = snapshot;
    console.log("[OTA-DIAG] ========== OTA DIAGNOSTICS ==========");
    console.log("[OTA-DIAG] isEnabled:", s.isEnabled);
    console.log("[OTA-DIAG] isEmbeddedLaunch:", s.isEmbeddedLaunch);
    console.log("[OTA-DIAG] emergencyLaunchReason:", s.emergencyLaunchReason);
    console.log("[OTA-DIAG] updateId:", s.updateId);
    console.log("[OTA-DIAG] channel:", s.channel);
    console.log("[OTA-DIAG] runtimeVersion:", s.runtimeVersion);
    console.log("[OTA-DIAG] createdAt:", s.createdAt);
    console.log("[OTA-DIAG] appVersion:", s.appVersion);
    console.log("[OTA-DIAG] ==========================================");
  }, []);

  const runCheck = useCallback(async () => {
    if (!Updates?.isEnabled) {
      setSnapshot((s) => ({ ...s, checkResult: "expo-updates not enabled (Expo Go / dev build)", checkError: null }));
      return;
    }
    setSnapshot((s) => ({ ...s, isChecking: true, checkResult: null, checkError: null }));
    try {
      const result = await Updates.checkForUpdateAsync();
      const msg = result.isAvailable
        ? `UPDATE AVAILABLE — manifest: ${JSON.stringify((result as any).manifest?.id ?? (result as any).updateId ?? "unknown")}`
        : "No update available (already on latest)";
      console.log("[OTA-DIAG] checkForUpdateAsync:", msg);
      setSnapshot((s) => ({ ...s, isChecking: false, checkResult: msg, checkError: null }));
    } catch (e: any) {
      const err = e?.message ?? String(e);
      console.error("[OTA-DIAG] checkForUpdateAsync ERROR:", err);
      setSnapshot((s) => ({ ...s, isChecking: false, checkResult: null, checkError: err }));
    }
  }, []);

  const runFetch = useCallback(async () => {
    if (!Updates?.isEnabled) {
      setSnapshot((s) => ({ ...s, fetchResult: "expo-updates not enabled", fetchError: null }));
      return;
    }
    setSnapshot((s) => ({ ...s, isFetching: true, fetchResult: null, fetchError: null }));
    try {
      const result = await Updates.fetchUpdateAsync();
      const msg = result.isNew
        ? `NEW UPDATE FETCHED — id: ${(result as any)?.manifest?.id ?? (result as any)?.updateId ?? "unknown"}`
        : "Fetch complete — isNew: false (already have latest)";
      console.log("[OTA-DIAG] fetchUpdateAsync:", msg);
      setSnapshot((s) => ({ ...s, isFetching: false, fetchResult: msg, fetchError: null }));
    } catch (e: any) {
      const err = e?.message ?? String(e);
      console.error("[OTA-DIAG] fetchUpdateAsync ERROR:", err);
      setSnapshot((s) => ({ ...s, isFetching: false, fetchResult: null, fetchError: err }));
    }
  }, []);

  const runReload = useCallback(async () => {
    if (!Updates) return;
    console.log("[OTA-DIAG] reloadAsync triggered manually from diagnostics screen");
    try {
      await Updates.reloadAsync();
    } catch (e: any) {
      console.error("[OTA-DIAG] reloadAsync ERROR:", e?.message ?? e);
    }
  }, []);

  const copyAll = useCallback(() => {
    const text = JSON.stringify(snapshot, null, 2);
    Clipboard.setString(text);
  }, [snapshot]);

  const isEmergency = !!snapshot.emergencyLaunchReason;
  const isEmbedded = snapshot.isEmbeddedLaunch;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, paddingTop: insets.top }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "rgba(255,255,255,0.08)" }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 12 }}>
          <ChevronLeft size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontSize: 17, fontWeight: "700" }}>OTA Diagnostics</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>expo-updates 0.{safeGet(() => require("expo-updates/package.json").version, "?")}</Text>
        </View>
        <Pressable onPress={copyAll} hitSlop={12} style={{ marginRight: 8 }}>
          <Copy size={18} color={colors.mutedForeground} />
        </Pressable>
        <Pressable onPress={() => setSnapshot({ capturedAt: new Date().toISOString(), ...getStaticSnapshot(), checkResult: null, fetchResult: null, checkError: null, fetchError: null, isChecking: false, isFetching: false })} hitSlop={12}>
          <RefreshCw size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Emergency banner */}
        {isEmergency && (
          <View style={{ backgroundColor: "rgba(255,69,58,0.15)", borderWidth: 1, borderColor: "#FF453A", borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: "row", gap: 10 }}>
            <AlertTriangle size={18} color="#FF453A" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#FF453A", fontWeight: "700", fontSize: 13 }}>EMERGENCY LAUNCH ACTIVE</Text>
              <Text style={{ color: "#FF453A", fontSize: 12, marginTop: 2 }}>{snapshot.emergencyLaunchReason}</Text>
            </View>
          </View>
        )}

        {/* Embedded launch banner */}
        {isEmbedded && !isEmergency && (
          <View style={{ backgroundColor: "rgba(255,159,10,0.12)", borderWidth: 1, borderColor: "#FF9F0A", borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: "row", gap: 10 }}>
            <AlertTriangle size={18} color="#FF9F0A" />
            <Text style={{ color: "#FF9F0A", fontSize: 13, fontWeight: "600", flex: 1 }}>Running embedded (binary) bundle — no OTA applied</Text>
          </View>
        )}

        {/* Static state */}
        <SectionHeader title="Current Launch" />
        <Row label="isEmbeddedLaunch" value={String(snapshot.isEmbeddedLaunch)} good={!snapshot.isEmbeddedLaunch} />
        <Row label="updateId" value={snapshot.updateId} mono />
        <Row label="createdAt" value={snapshot.createdAt} />
        <Row label="emergencyLaunchReason" value={snapshot.emergencyLaunchReason} danger={!!snapshot.emergencyLaunchReason} />

        <SectionHeader title="Build Config" />
        <Row label="channel" value={snapshot.channel} mono />
        <Row label="runtimeVersion" value={snapshot.runtimeVersion} mono />
        <Row label="isEnabled" value={String(snapshot.isEnabled)} good={snapshot.isEnabled} danger={!snapshot.isEnabled} />
        <Row label="appVersion" value={snapshot.appVersion} />
        <Row label="appEnv" value={snapshot.appEnv} />
        <Row label="platform" value={Platform.OS + " " + Platform.Version} />
        <Row label="capturedAt" value={snapshot.capturedAt} />

        <SectionHeader title="Check for Update" />
        <Row
          label="result"
          value={snapshot.checkError ? `ERROR: ${snapshot.checkError}` : snapshot.checkResult}
          danger={!!snapshot.checkError}
          good={snapshot.checkResult?.includes("AVAILABLE") ?? false}
        />

        <SectionHeader title="Fetch Update" />
        <Row
          label="result"
          value={snapshot.fetchError ? `ERROR: ${snapshot.fetchError}` : snapshot.fetchResult}
          danger={!!snapshot.fetchError}
          good={snapshot.fetchResult?.includes("NEW UPDATE") ?? false}
        />

        {/* Actions */}
        <SectionHeader title="Actions" />

        <Pressable
          onPress={runCheck}
          disabled={snapshot.isChecking}
          style={{ backgroundColor: "rgba(138,64,207,0.15)", borderWidth: 1, borderColor: "#8A40CF", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8, flexDirection: "row", justifyContent: "center", gap: 8 }}
        >
          {snapshot.isChecking ? <ActivityIndicator size="small" color="#8A40CF" /> : <RefreshCw size={16} color="#8A40CF" />}
          <Text style={{ color: "#8A40CF", fontWeight: "700", fontSize: 14 }}>
            {snapshot.isChecking ? "Checking…" : "checkForUpdateAsync()"}
          </Text>
        </Pressable>

        <Pressable
          onPress={runFetch}
          disabled={snapshot.isFetching}
          style={{ backgroundColor: "rgba(48,209,88,0.1)", borderWidth: 1, borderColor: "#30D158", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8, flexDirection: "row", justifyContent: "center", gap: 8 }}
        >
          {snapshot.isFetching ? <ActivityIndicator size="small" color="#30D158" /> : <CheckCircle size={16} color="#30D158" />}
          <Text style={{ color: "#30D158", fontWeight: "700", fontSize: 14 }}>
            {snapshot.isFetching ? "Fetching…" : "fetchUpdateAsync()"}
          </Text>
        </Pressable>

        <Pressable
          onPress={runReload}
          style={{ backgroundColor: "rgba(255,69,58,0.1)", borderWidth: 1, borderColor: "#FF453A", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8, flexDirection: "row", justifyContent: "center", gap: 8 }}
        >
          <XCircle size={16} color="#FF453A" />
          <Text style={{ color: "#FF453A", fontWeight: "700", fontSize: 14 }}>reloadAsync() — apply & restart</Text>
        </Pressable>

        <Text style={{ color: colors.mutedForeground, fontSize: 11, textAlign: "center", marginTop: 16 }}>
          All fields logged to console on screen mount.{"\n"}
          Use Copy button to export full JSON for incident reports.
        </Text>
      </ScrollView>
    </View>
  );
}
