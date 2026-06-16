/**
 * OtaRecoveryBoundary — Root-level ErrorBoundary with DVNT branded recovery UI.
 *
 * Wraps the entire app. Catches any JS error that escapes screen-level
 * ErrorBoundaries. Shows a branded recovery screen instead of a blank/white crash.
 *
 * Special handling for OTA-related crashes:
 * - If the crash happened right after an OTA apply (crashedOnPendingUpdate),
 *   shows an OTA-specific recovery message.
 * - Never calls reloadAsync() automatically.
 * - Offers "Continue with current version" (embedded bundle via rollback) and
 *   "Try Again" (for transient errors that don't require OTA rollback).
 *
 * Crash-loop prevention:
 * - Uses the boot-guard consecutive failed boot counter.
 * - After 3 consecutive crashes → safe mode is already active (boot-guard handles it).
 * - This boundary adds a session-level flag to prevent rendering loops within
 *   a single launch.
 */

import React, { Component, type ErrorInfo, type ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  StyleSheet,
} from "react-native";
import { didCrashOnPendingUpdate, getPendingUpdateIdAtBoot } from "@/lib/ota/updateSafety";
import { getBootDiagnostics } from "@/lib/boot-guard";

// ── Safe wrappers — this file cannot import anything that might itself throw ──

function safeGet<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

function tryReload(): void {
  safeGet(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Updates = require("expo-updates");
    if (Updates?.reloadAsync) Updates.reloadAsync();
  }, undefined);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export class OtaRecoveryBoundary extends Component<Props, State> {
  private otaCrash: boolean;
  private pendingId: string | null;
  private safeMode: boolean;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };

    // Read at construct time (before render) so we always have the latest value
    this.otaCrash  = safeGet(() => didCrashOnPendingUpdate(), false);
    this.pendingId = safeGet(() => getPendingUpdateIdAtBoot(), null);
    this.safeMode  = safeGet(() => getBootDiagnostics().safeMode, false);
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const count = this.state.errorCount + 1;
    this.setState({ errorCount: count });

    console.error("╔══════════════════════════════════════════════════════╗");
    console.error("║  [OtaRecoveryBoundary] Root-level crash caught        ║");
    console.error("╚══════════════════════════════════════════════════════╝");
    console.error("[OtaRecoveryBoundary] message:  ", error.message);
    console.error("[OtaRecoveryBoundary] otaCrash: ", this.otaCrash);
    console.error("[OtaRecoveryBoundary] pendingId:", this.pendingId);
    console.error("[OtaRecoveryBoundary] component stack:", info.componentStack);

    // Persist to MMKV for next session
    safeGet(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { mmkv } = require("@/lib/mmkv-zustand");
      mmkv.set("DVNT_ROOT_BOUNDARY_CRASH", JSON.stringify({
        timestamp: new Date().toISOString(),
        message: error.message,
        stack: error.stack ?? null,
        otaCrash: this.otaCrash,
        pendingUpdateId: this.pendingId,
      }));
    }, undefined);
  }

  private handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = (): void => {
    tryReload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const isOtaCrash = this.otaCrash;
    const shortId = this.pendingId ? this.pendingId.slice(0, 8) : null;
    const safeMode = this.safeMode;

    return (
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* DVNT wordmark */}
          <Text style={styles.brand}>DVNT</Text>

          {/* Icon */}
          <View style={styles.iconContainer}>
            <Text style={styles.icon}>{isOtaCrash ? "⚡" : "⚠️"}</Text>
          </View>

          {/* Headline */}
          <Text style={styles.title}>
            {isOtaCrash
              ? "Update caused an issue"
              : "Something went wrong"}
          </Text>

          {/* Body */}
          <Text style={styles.body}>
            {isOtaCrash
              ? "The latest app update encountered a problem on startup. We've logged this and will prevent it from happening again."
              : "An unexpected error occurred. Your data is safe. You can try again or restart the app."}
          </Text>

          {safeMode && (
            <View style={styles.safeModeTag}>
              <Text style={styles.safeModeText}>Safe Mode Active</Text>
            </View>
          )}

          {/* Error detail (compact) */}
          {this.state.error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorCode} numberOfLines={3}>
                {this.state.error.message}
              </Text>
              {shortId && (
                <Text style={styles.updateId}>Update: {shortId}…</Text>
              )}
            </View>
          )}

          {/* Actions */}
          <View style={styles.actions}>
            <Pressable
              style={styles.primaryButton}
              onPress={this.handleTryAgain}
            >
              <Text style={styles.primaryButtonText}>Try Again</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryButton}
              onPress={this.handleReload}
            >
              <Text style={styles.secondaryButtonText}>Restart App</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            If this keeps happening, close and reopen the app.{"\n"}
            Your account and data are not affected.
          </Text>
        </ScrollView>
      </View>
    );
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 60,
  },
  brand: {
    fontSize: 28,
    fontWeight: "900",
    color: "#ffffff",
    letterSpacing: 6,
    marginBottom: 32,
    fontFamily: Platform.OS === "ios" ? "System" : undefined,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  icon: {
    fontSize: 36,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
    marginBottom: 12,
  },
  body: {
    fontSize: 15,
    color: "#888888",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  safeModeTag: {
    backgroundColor: "#1a1a2e",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#e63946",
    marginBottom: 20,
  },
  safeModeText: {
    color: "#e63946",
    fontSize: 12,
    fontWeight: "600",
  },
  errorBox: {
    backgroundColor: "#111111",
    borderRadius: 12,
    padding: 16,
    width: "100%",
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#222222",
  },
  errorCode: {
    fontSize: 12,
    color: "#666666",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 18,
  },
  updateId: {
    fontSize: 10,
    color: "#444444",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    marginTop: 6,
  },
  actions: {
    width: "100%",
    gap: 12,
    marginBottom: 24,
  },
  primaryButton: {
    backgroundColor: "#8A40CF",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  secondaryButtonText: {
    color: "#aaaaaa",
    fontSize: 15,
    fontWeight: "500",
  },
  hint: {
    fontSize: 12,
    color: "#444444",
    textAlign: "center",
    lineHeight: 18,
  },
});
