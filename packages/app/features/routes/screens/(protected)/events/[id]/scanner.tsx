/**
 * Ticket Scanner Screen — VisionCamera QR Code Scanner
 *
 * Organizer scans tickets at the door using the device camera.
 * Uses react-native-vision-camera for high-perf scanning.
 * Falls back gracefully if VisionCamera is unavailable.
 */

import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { ErrorBoundary } from "@dvnt/app/components/error-boundary";
import { useState, useCallback, useEffect, useRef } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  useReducedMotion,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import {
  ArrowLeft,
  ScanLine,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Zap,
  ZapOff,
} from "lucide-react-native";
import type { ScanAddonSummary } from "@dvnt/app/lib/api/tickets";
import { useScanTicket } from "@dvnt/app/lib/hooks/use-tickets";
import { useEvent } from "@dvnt/app/lib/hooks/use-events";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useOfflineCheckinStore } from "@dvnt/app/lib/stores/offline-checkin-store";
import { getCurrentUserIdSync } from "@dvnt/app/lib/auth/identity";
import * as Haptics from "expo-haptics";

// Lazy-load VisionCamera to prevent crashes if not installed
let Camera: any = null;
let useCameraDevice: any = null;
let useCameraFormat: any = null;
let useCameraPermission: any = null;
let useBarcodeScannerOutput: any = null;

try {
  const vc = require("react-native-vision-camera");
  const barcodeScanner = require("react-native-vision-camera-barcode-scanner");
  Camera = vc.Camera;
  useCameraDevice = vc.useCameraDevice;
  useCameraFormat = vc.useCameraFormat;
  useCameraPermission = vc.useCameraPermission;
  useBarcodeScannerOutput = barcodeScanner.useBarcodeScannerOutput;
} catch {
  // VisionCamera not available
}

// All three must be present for the scanner to work
const hasVisionCamera =
  Camera != null &&
  useCameraDevice != null &&
  useCameraPermission != null &&
  useBarcodeScannerOutput != null;

type ScanResult = {
  type: "success" | "error" | "already_scanned" | "not_found";
  /** "addon" when the scanned QR was an order_addons redemption. */
  kind?: "ticket" | "addon";
  name?: string;
  tierName?: string;
  message?: string;
  /** Order add-ons shown on the result card ("VIP table ×1 — unredeemed"). */
  addons?: ScanAddonSummary[];
  /** already_scanned: the ORIGINAL check-in facts from the server CAS. */
  checkedInAt?: string | null;
  checkedInByName?: string | null;
  /** Duplicate verdict painted from LOCAL knowledge (<300ms) pending server. */
  optimistic?: boolean;
};

type ScanHistoryEntry = {
  id: string;
  type: ScanResult["type"];
  name?: string;
  tierName?: string;
  timestamp: number;
};

// ── AddonRows ─────────────────────────────────────────────────────────────────
// Order add-ons on the scan result card: "VIP table ×1 — unredeemed".
function AddonRows({ addons }: { addons: ScanAddonSummary[] }) {
  if (!addons.length) return null;
  return (
    <View
      style={{
        width: "100%",
        backgroundColor: "rgba(0,0,0,0.25)",
        borderRadius: 12,
        padding: 8,
        marginTop: 4,
      }}
    >
      <Text
        style={{
          color: "rgba(255,255,255,0.5)",
          fontSize: 10,
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: 1,
          paddingHorizontal: 4,
          paddingBottom: 4,
        }}
      >
        Add-ons
      </Text>
      {addons.map((a, i) => {
        const redeemed = a.status === "redeemed";
        const refunded = a.status === "refunded";
        const state = refunded
          ? "refunded"
          : redeemed
            ? "redeemed"
            : "unredeemed";
        return (
          <View
            key={a.id}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              paddingHorizontal: 4,
              paddingVertical: 6,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: "rgba(255,255,255,0.1)",
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: "#fff",
                fontSize: 13,
                fontWeight: "500",
              }}
            >
              {a.name}
              {a.variant_name ? (
                <Text style={{ color: "rgba(255,255,255,0.6)" }}>
                  {" "}
                  · {a.variant_name}
                </Text>
              ) : null}
              <Text
                style={{
                  color: "rgba(255,255,255,0.8)",
                  fontVariant: ["tabular-nums"],
                }}
              >
                {" "}
                ×{a.quantity}
              </Text>
            </Text>
            <View
              style={{
                borderRadius: 4,
                paddingHorizontal: 6,
                paddingVertical: 2,
                backgroundColor:
                  redeemed || refunded ? "rgba(0,0,0,0.4)" : "#fff",
              }}
            >
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: "600",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  color:
                    redeemed || refunded ? "rgba(255,255,255,0.6)" : "#000",
                  textDecorationLine: refunded ? "line-through" : "none",
                }}
              >
                {state}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── DuplicateFlash ────────────────────────────────────────────────────────────
// LOUD full-screen duplicate flag: solid signal-red flash + the ORIGINAL scan
// time/scanner rendered large. Paints optimistically (<300ms) when the offline
// store already knew the token; server confirmation replaces it. Honors
// reduced-motion (no strobe, static red).
function DuplicateFlash({
  result,
  onDismiss,
}: {
  result: ScanResult;
  onDismiss: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const flash = useSharedValue(1);
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  useEffect(() => {
    if (reducedMotion) return;
    // Double-strobe inside the 280ms motion budget, then settle solid.
    flash.value = 0.35;
    flash.value = withSequence(
      withTiming(1, { duration: 70 }),
      withTiming(0.55, { duration: 60 }),
      withTiming(1, { duration: 150 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

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
    <Animated.View
      entering={FadeIn.duration(80)}
      exiting={FadeOut.duration(150)}
      style={[
        {
          position: "absolute",
          inset: 0,
          backgroundColor: "#FC253A",
          zIndex: 110,
        },
        flashStyle,
      ]}
    >
      <Pressable
        onPress={onDismiss}
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 32,
        }}
      >
        <AlertTriangle size={64} color="#fff" strokeWidth={2.5} />
        <Text
          style={{
            color: "#fff",
            fontSize: 28,
            fontWeight: "700",
            textTransform: "uppercase",
            letterSpacing: 2,
            textAlign: "center",
          }}
        >
          Already scanned
        </Text>
        {result.kind === "addon" && result.name ? (
          <Text style={{ color: "rgba(255,255,255,0.95)", fontSize: 16, fontWeight: "600" }}>
            {result.name}
          </Text>
        ) : null}
        {timeLabel ? (
          <Text
            selectable
            style={{
              color: "#fff",
              fontSize: 40,
              fontWeight: "800",
              fontVariant: ["tabular-nums"],
            }}
          >
            {timeLabel}
          </Text>
        ) : null}
        {dateLabel || result.checkedInByName ? (
          <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, fontWeight: "500" }}>
            {dateLabel}
            {result.checkedInByName ? ` · by ${result.checkedInByName}` : ""}
          </Text>
        ) : null}
        {!timeLabel && result.message ? (
          <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 15, textAlign: "center" }}>
            {result.message}
          </Text>
        ) : null}
        {result.optimistic ? (
          <Text
            style={{
              color: "rgba(255,255,255,0.7)",
              fontSize: 12,
              fontWeight: "600",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            Confirming with server…
          </Text>
        ) : null}
        {result.addons?.length ? (
          <View style={{ width: "100%", maxWidth: 360 }}>
            <AddonRows addons={result.addons} />
          </View>
        ) : null}
        <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 8 }}>
          Tap anywhere to scan next
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function ScanResultOverlay({
  result,
  onDismiss,
}: {
  result: ScanResult;
  onDismiss: () => void;
}) {
  const scale = useSharedValue(0.8);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  useEffect(() => {
    scale.value = withSequence(
      withTiming(1.05, { duration: 150 }),
      withTiming(1, { duration: 100 }),
    );
  }, []);

  // Duplicates get the loud full-screen treatment.
  if (result.type === "already_scanned") {
    return <DuplicateFlash result={result} onDismiss={onDismiss} />;
  }

  const isSuccess = result.type === "success";
  const bgColor = isSuccess
    ? "rgba(34, 197, 94, 0.95)"
    : "rgba(239, 68, 68, 0.95)";
  const Icon = isSuccess ? CheckCircle2 : XCircle;

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={{
        position: "absolute",
        inset: 0,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "rgba(0,0,0,0.7)",
        zIndex: 100,
      }}
    >
      <Pressable
        onPress={onDismiss}
        style={{ flex: 1, justifyContent: "center" }}
      >
        <Animated.View
          style={[
            {
              backgroundColor: bgColor,
              borderRadius: 24,
              padding: 32,
              alignItems: "center",
              marginHorizontal: 40,
              gap: 12,
            },
            animatedStyle,
          ]}
        >
          <Icon size={56} color="#fff" strokeWidth={2} />
          <Text
            style={{
              color: "#fff",
              fontSize: 22,
              fontWeight: "700",
              textAlign: "center",
            }}
          >
            {isSuccess
              ? result.kind === "addon"
                ? "Add-on Redeemed!"
                : "Checked In!"
              : result.type === "not_found"
                ? "Invalid Ticket"
                : "Scan Error"}
          </Text>
          {result.name && (
            <Text
              style={{
                color: "rgba(255,255,255,0.9)",
                fontSize: 16,
                fontWeight: "500",
              }}
            >
              {result.name}
            </Text>
          )}
          {result.tierName && (
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>
              {result.tierName}
            </Text>
          )}
          {result.message && (
            <Text
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              {result.message}
            </Text>
          )}
          {result.addons?.length ? <AddonRows addons={result.addons} /> : null}
          <Text
            style={{
              color: "rgba(255,255,255,0.5)",
              fontSize: 12,
              marginTop: 8,
            }}
          >
            Tap anywhere to scan next
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

// ── LiveCamera ────────────────────────────────────────────────────────────────
// Separate component so useBarcodeScannerOutput + useCameraDevice are
// always called unconditionally (Rules of Hooks).
function LiveCamera({
  onCodeScanned,
  torchOn,
}: {
  onCodeScanned: (codes: any[]) => void;
  torchOn: boolean;
}) {
  const device = useCameraDevice("back");
  const barcodeScannerOutput = useBarcodeScannerOutput({
    barcodeFormats: ["qr-code"],
    outputResolution: "full",
    onBarcodeScanned: onCodeScanned,
    onError: (error: Error) => {
      console.error("[Scanner] Barcode scan error:", error);
    },
  });

  if (!device) return null;

  return (
    <Camera
      style={{ flex: 1 }}
      device={device}
      isActive={true}
      outputs={[barcodeScannerOutput]}
      torchMode={torchOn ? "on" : "off"}
      enableZoomGesture
      resizeMode="cover"
    />
  );
}

// ── ScannerWithCamera ─────────────────────────────────────────────────────────
// Only rendered when hasVisionCamera is true.
// Calls useCameraPermission() unconditionally at the top level.
function ScannerWithCamera({ eventId }: { eventId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const authUser = useAuthStore((s) => s.user);
  const scanMutation = useScanTicket();
  const offlineStore = useOfflineCheckinStore();
  const hasOfflineData = offlineStore.hasOfflineData(eventId);

  // Always call useCameraPermission unconditionally (no ternary)
  const { hasPermission, requestPermission } = useCameraPermission();

  const [torchOn, setTorchOn] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const lastScannedRef = useRef<string>("");
  const cooldownRef = useRef(false);

  useEffect(() => {
    if (!hasPermission) {
      requestPermission();
    }
  }, [hasPermission, requestPermission]);

  const handleCodeScanned = useCallback(
    (codes: any[]) => {
      console.log(
        "[Scanner] handleCodeScanned fired — codes.length=",
        codes?.length,
        "cooldown=",
        cooldownRef.current,
        "hasResult=",
        !!scanResult,
      );
      if (cooldownRef.current || scanResult) return;
      const code = codes[0];
      const qrValue = code?.rawValue ?? code?.value;
      console.log(
        "[Scanner] qrValue=",
        qrValue ? qrValue.substring(0, 40) : "(empty)",
      );
      if (!qrValue) return;

      if (qrValue === lastScannedRef.current) return;
      lastScannedRef.current = qrValue;
      cooldownRef.current = true;

      let qrToken = qrValue;
      const deepLinkMatch = qrValue.match(/dvnt:\/\/ticket\/(.+)/);
      if (deepLinkMatch) {
        qrToken = deepLinkMatch[1];
      }
      console.log("[Scanner] dispatching scan, qrToken prefix=", qrToken.substring(0, 12));

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      // ── <300ms duplicate first paint ──────────────────────────────
      // If this device already knows the token was scanned (offline set
      // or a prior online success), flip the loud duplicate UI + warning
      // haptic NOW from local knowledge; the server confirmation (with
      // the ORIGINAL checked_in_at/by) follows. Server always wins.
      const knownDuplicate = offlineStore.isAlreadyScanned(eventId, qrToken);
      if (knownDuplicate) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setScanResult({
          type: "already_scanned",
          optimistic: true,
          message: "This ticket was already scanned on this device",
        });
        setScanHistory((h) =>
          [
            {
              id: `${Date.now()}`,
              type: "already_scanned" as const,
              timestamp: Date.now(),
            },
            ...h,
          ].slice(0, 50),
        );
      }

      scanMutation.mutate(
        { qrToken, scannedBy: authUser?.id, eventId },
        {
          onSuccess: (data) => {
            if (data.valid) {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              const isAddon = data.kind === "addon";
              const name = isAddon
                ? [data.addon?.name, data.addon?.variant_name]
                    .filter(Boolean)
                    .join(" · ")
                : data.ticket?.name;
              const tierName = isAddon
                ? `Add-on ×${data.addon?.quantity ?? 1}`
                : data.ticket?.tier_name;
              const entry: ScanHistoryEntry = {
                id: `${Date.now()}`,
                type: "success",
                name,
                tierName,
                timestamp: Date.now(),
              };
              setScanResult({
                type: "success",
                kind: data.kind ?? "ticket",
                name,
                tierName,
                addons: data.addons,
              });
              setScanCount((c) => c + 1);
              setScanHistory((h) => [entry, ...h].slice(0, 50));
              // Seed local knowledge so a re-scan flips instantly.
              offlineStore.markScannedLocal(eventId, qrToken);
            } else {
              const isDuplicate = data.reason === "already_scanned";
              Haptics.notificationAsync(
                isDuplicate
                  ? Haptics.NotificationFeedbackType.Warning
                  : Haptics.NotificationFeedbackType.Error,
              );
              const resultType = isDuplicate
                ? ("already_scanned" as const)
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
                message: isDuplicate
                  ? "This ticket was already scanned"
                  : data.reason === "refunded"
                    ? "This ticket has been refunded"
                    : "This QR code is not a valid ticket",
              });
              if (isDuplicate) {
                offlineStore.markScannedLocal(eventId, qrToken);
              }
              // Optimistic paint already logged this duplicate.
              if (!(isDuplicate && knownDuplicate)) {
                setScanHistory((h) =>
                  [
                    {
                      id: `${Date.now()}`,
                      type: resultType,
                      timestamp: Date.now(),
                    },
                    ...h,
                  ].slice(0, 50),
                );
              }
            }
          },
          onError: () => {
            // Network down — the optimistic duplicate verdict stands.
            if (knownDuplicate) return;
            if (hasOfflineData) {
              if (offlineStore.isAlreadyScanned(eventId, qrToken)) {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Warning,
                );
                setScanResult({
                  type: "already_scanned",
                  optimistic: true,
                  message: "This ticket was already scanned (offline)",
                });
                setScanHistory((h) =>
                  [
                    {
                      id: `${Date.now()}`,
                      type: "already_scanned" as const,
                      timestamp: Date.now(),
                    },
                    ...h,
                  ].slice(0, 50),
                );
              } else if (offlineStore.isTokenValid(eventId, qrToken)) {
                offlineStore.markScannedOffline(eventId, qrToken, authUser?.id);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                setScanResult({
                  type: "success",
                  name: "Verified Offline",
                  tierName: undefined,
                });
                setScanCount((c) => c + 1);
                setScanHistory((h) =>
                  [
                    {
                      id: `${Date.now()}`,
                      type: "success" as const,
                      name: "Verified Offline",
                      timestamp: Date.now(),
                    },
                    ...h,
                  ].slice(0, 50),
                );
              } else if (offlineStore.isAddonTokenValid(eventId, qrToken)) {
                // Add-on rail — queue with the kind discriminator.
                offlineStore.markScannedOffline(
                  eventId,
                  qrToken,
                  authUser?.id,
                  "addon",
                );
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                setScanResult({
                  type: "success",
                  kind: "addon",
                  name: "Add-on Verified Offline",
                });
                setScanCount((c) => c + 1);
                setScanHistory((h) =>
                  [
                    {
                      id: `${Date.now()}`,
                      type: "success" as const,
                      name: "Add-on Verified Offline",
                      timestamp: Date.now(),
                    },
                    ...h,
                  ].slice(0, 50),
                );
              } else {
                Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Error,
                );
                setScanResult({
                  type: "not_found",
                  message: "Not a valid ticket (offline check)",
                });
                setScanHistory((h) =>
                  [
                    {
                      id: `${Date.now()}`,
                      type: "not_found" as const,
                      timestamp: Date.now(),
                    },
                    ...h,
                  ].slice(0, 50),
                );
              }
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              setScanResult({
                type: "error",
                message:
                  "Network error. Download tickets for offline scanning.",
              });
            }
          },
        },
      );
    },
    [scanResult, scanMutation, authUser?.id, eventId, hasOfflineData, offlineStore],
  );

  const dismissResult = useCallback(() => {
    setScanResult(null);
    lastScannedRef.current = "";
    cooldownRef.current = false;
  }, []);

  if (!hasPermission) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-8">
        <ScanLine size={64} color="rgba(255,255,255,0.3)" />
        <Text className="text-white text-lg font-sans-semibold mt-4 text-center">
          Camera Permission Required
        </Text>
        <Pressable
          onPress={() => requestPermission()}
          className="mt-6 bg-primary rounded-full px-6 py-3"
        >
          <Text className="text-black font-sans-semibold">
            Grant Permission
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      {/* Camera — always called unconditionally inside LiveCamera */}
      <LiveCamera onCodeScanned={handleCodeScanned} torchOn={torchOn} />

      {/* Scan overlay frame */}
      <View
        style={{
          position: "absolute",
          inset: 0,
          justifyContent: "center",
          alignItems: "center",
        }}
        pointerEvents="none"
      >
        <View
          style={{
            width: 260,
            height: 260,
            borderWidth: 2,
            borderColor: "rgba(255,255,255,0.4)",
            borderRadius: 24,
          }}
        />
      </View>

      {/* Top bar */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          backgroundColor: "rgba(0,0,0,0.5)",
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          className="w-10 h-10 items-center justify-center rounded-full bg-white/10"
        >
          <ArrowLeft size={20} color="#fff" />
        </Pressable>

        <Animated.View entering={FadeInDown.duration(300)}>
          <Text className="text-white font-sans-bold text-lg">
            Scan Tickets
          </Text>
        </Animated.View>

        <Pressable
          onPress={() => setTorchOn((t) => !t)}
          className="w-10 h-10 items-center justify-center rounded-full bg-white/10"
        >
          {torchOn ? (
            <ZapOff size={18} color="#FCD34D" />
          ) : (
            <Zap size={18} color="#fff" />
          )}
        </Pressable>
      </View>

      {/* Bottom stats + history */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: insets.bottom + 12,
          paddingHorizontal: 16,
          paddingTop: 12,
          backgroundColor: "rgba(0,0,0,0.75)",
          maxHeight: showHistory ? 320 : undefined,
        }}
      >
        <Pressable
          onPress={() => setShowHistory((v) => !v)}
          className="flex-row items-center justify-between"
        >
          <View className="flex-row items-center gap-2">
            <CheckCircle2 size={16} color="#22C55E" />
            <Text className="text-white font-sans-semibold text-sm">
              {scanCount} scanned
            </Text>
          </View>
          {scanHistory.length > 0 && (
            <Text className="text-white/50 text-xs">
              {showHistory
                ? "Hide history"
                : `${scanHistory.length} recent · Tap to expand`}
            </Text>
          )}
          {scanHistory.length === 0 && (
            <Text className="text-white/50 text-xs">
              Point camera at QR code
            </Text>
          )}
        </Pressable>

        {showHistory && scanHistory.length > 0 && (
          <ScrollView
            style={{ maxHeight: 220, marginTop: 10 }}
            showsVerticalScrollIndicator={false}
          >
            {scanHistory.map((entry) => {
              const isOk = entry.type === "success";
              const isDup = entry.type === "already_scanned";
              const color = isOk ? "#22C55E" : isDup ? "#FBBF24" : "#EF4444";
              const label = isOk
                ? entry.name || "Checked In"
                : isDup
                  ? "Already Scanned"
                  : "Invalid";
              const time = new Date(entry.timestamp).toLocaleTimeString(
                "en-US",
                {
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                },
              );
              return (
                <View
                  key={entry.id}
                  className="flex-row items-center justify-between py-2"
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <View className="flex-row items-center gap-2 flex-1">
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: color,
                      }}
                    />
                    <Text
                      className="text-white text-xs font-sans-medium"
                      numberOfLines={1}
                    >
                      {label}
                    </Text>
                    {entry.tierName && (
                      <Text className="text-white/40 text-xs">
                        · {entry.tierName}
                      </Text>
                    )}
                  </View>
                  <Text className="text-white/30 text-[10px]">{time}</Text>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>

      {scanResult && (
        <ScanResultOverlay result={scanResult} onDismiss={dismissResult} />
      )}

      {scanMutation.isPending && !scanResult && (
        <View
          style={{
            position: "absolute",
            inset: 0,
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "rgba(0,0,0,0.5)",
          }}
        >
          <ActivityIndicator size="large" color="#fff" />
          <Text className="text-white mt-2">Validating...</Text>
        </View>
      )}
    </View>
  );
}

// ── ScannerContent ────────────────────────────────────────────────────────────
// Gate: shows fallback UI when VisionCamera isn't available,
// otherwise renders ScannerWithCamera (which calls hooks unconditionally).
function ScannerContent({ eventId }: { eventId: string }) {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { data: event, isLoading: eventLoading } = useEvent(eventId);

  // Host-only gate. Without this, anyone could deep-link to
  // /events/<id>/scanner and access the camera. Server enforces the
  // same check on ticket-scan, but failing fast on the client avoids
  // even rendering the camera surface to unauthorized users.
  const isHost = (() => {
    if (!user?.id || !event?.host?.id) return false;
    const hostId = String(event.host.id);
    if (String(user.id) === hostId) return true;
    const intId = getCurrentUserIdSync();
    if (intId != null && String(intId) === hostId) return true;
    const authId = (user as any)?.authId || (user as any)?.auth_id;
    if (authId && String(authId) === hostId) return true;
    return false;
  })();

  if (eventLoading) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!isHost) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-8">
        <XCircle size={64} color="#ef4444" />
        <Text className="text-white text-lg font-sans-semibold mt-4 text-center">
          Not authorized
        </Text>
        <Text className="text-white/60 text-sm mt-2 text-center">
          Only the event host can scan tickets at the door.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-6 bg-white/10 rounded-full px-6 py-3"
        >
          <Text className="text-white font-sans-semibold">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  if (!hasVisionCamera) {
    return (
      <View className="flex-1 bg-black items-center justify-center px-8">
        <ScanLine size={64} color="rgba(255,255,255,0.3)" />
        <Text className="text-white text-lg font-sans-semibold mt-4 text-center">
          Camera Scanner Unavailable
        </Text>
        <Text className="text-white/60 text-sm mt-2 text-center">
          react-native-vision-camera is required for ticket scanning. Please
          install it in your development build.
        </Text>
        <Pressable
          onPress={() => router.back()}
          className="mt-6 bg-white/10 rounded-full px-6 py-3"
        >
          <Text className="text-white font-sans-semibold">Go Back</Text>
        </Pressable>
      </View>
    );
  }

  return <ScannerWithCamera eventId={eventId} />;
}

export default function TicketScannerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  return (
    <ErrorBoundary screenName="TicketScanner" onGoBack={() => router.back()}>
      <ScannerContent eventId={id || ""} />
    </ErrorBoundary>
  );
}
