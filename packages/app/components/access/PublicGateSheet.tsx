import { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { ArrowRight, Lock, ShieldCheck, X } from "lucide-react-native";
import { GlassSheetBackground } from "@dvnt/app/components/sheets/glass-sheet-background";
import { getPublicGateConfig } from "@dvnt/app/lib/access/public-gates";
import { usePublicGateStore } from "@dvnt/app/lib/stores/public-gate-store";
import { AppTrace } from "@dvnt/app/lib/diagnostics/app-trace";

export function PublicGateSheet() {
  const router = useRouter();
  const reason = usePublicGateStore((s) => s.reason);
  const closeGate = usePublicGateStore((s) => s.closeGate);
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ["48%"], []);

  const config = reason ? getPublicGateConfig(reason) : null;

  useEffect(() => {
    if (!reason) return;
    requestAnimationFrame(() => {
      sheetRef.current?.present();
    });
  }, [reason]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        opacity={0.5}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleDismiss = useCallback(() => {
    if (reason) {
      AppTrace.trace("PUBLIC_GATE", "dismissed", { reason });
    }
    closeGate();
  }, [closeGate, reason]);

  const handleSignup = useCallback(() => {
    if (reason) {
      AppTrace.trace("PUBLIC_GATE", "cta_signup", { reason });
    }
    closeGate();
    router.push("/(auth)/signup" as any);
  }, [closeGate, reason, router]);

  const handleLogin = useCallback(() => {
    if (reason) {
      AppTrace.trace("PUBLIC_GATE", "cta_login", { reason });
    }
    closeGate();
    router.push("/(auth)/login" as any);
  }, [closeGate, reason, router]);

  if (!config) return null;

  return (
    <BottomSheetModal
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      backdropComponent={renderBackdrop}
      backgroundComponent={GlassSheetBackground}
      handleIndicatorStyle={styles.handle}
      onDismiss={handleDismiss}
      onChange={(index) => {
        if (index === -1) handleDismiss();
      }}
    >
      <BottomSheetView style={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerBadge}>
            <Lock size={16} color="#fff" />
            <Text style={styles.headerBadgeText}>{config.eyebrow}</Text>
          </View>
          <Pressable onPress={handleDismiss} hitSlop={12} style={styles.close}>
            <X size={18} color="#d4d4d8" />
          </Pressable>
        </View>

        <Text style={styles.title}>{config.title}</Text>
        <Text style={styles.description}>{config.description}</Text>

        <View style={styles.note}>
          <ShieldCheck size={18} color="#34A2DF" />
          <Text style={styles.noteText}>
            Sweet-only browsing stays open. Private messaging, comments, spicy
            content, and hosting stay protected.
          </Text>
        </View>

        <View style={styles.actions}>
          <Pressable onPress={handleSignup} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{config.primaryCta}</Text>
            <ArrowRight size={16} color="#000" />
          </Pressable>

          <Pressable onPress={handleLogin} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>{config.secondaryCta}</Text>
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  handle: {
    backgroundColor: "rgba(255,255,255,0.28)",
    width: 40,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  headerBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  title: {
    color: "#fff",
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
  },
  description: {
    color: "rgba(228,228,231,0.82)",
    fontSize: 15,
    lineHeight: 22,
  },
  note: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 18,
    backgroundColor: "rgba(52,162,223,0.1)",
    borderWidth: 1,
    borderColor: "rgba(52,162,223,0.16)",
  },
  noteText: {
    flex: 1,
    color: "#d4d4d8",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryButtonText: {
    color: "#000",
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  secondaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
});
