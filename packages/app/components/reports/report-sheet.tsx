/**
 * Global ReportSheet — the single UI for filing a content report.
 *
 * Mounted once in app/_layout.tsx. Listens to `useReportSheetStore` for
 * an open target, presents Apple-aligned reason categories, fires the
 * `reportsApi.reportContent()` call, and toasts the outcome.
 *
 * Keeps the per-screen wiring to a single function call:
 *   openReportSheet({ entityType: "post", entityId: String(post.id) })
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Flag, X, Check } from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { useReportSheetStore } from "@dvnt/app/lib/stores/report-sheet-store";
import { useUIStore } from "@dvnt/app/lib/stores/ui-store";
import {
  reportsApi,
  REPORT_REASON_OPTIONS,
  type ReportReason,
} from "@dvnt/app/lib/api/reports";

const SNAP_POINTS = ["75%"];

export function ReportSheet() {
  const { colors } = useColorScheme();
  const visible = useReportSheetStore((s) => s.visible);
  const target = useReportSheetStore((s) => s.target);
  const closeReportSheet = useReportSheetStore((s) => s.closeReportSheet);
  const showToast = useUIStore((s) => s.showToast);

  const sheetRef = useRef<BottomSheet>(null);
  const [selectedReason, setSelectedReason] = useState<ReportReason | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setSelectedReason(null);
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1 && visible) closeReportSheet();
    },
    [visible, closeReportSheet],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (!target || !selectedReason || submitting) return;
    setSubmitting(true);
    try {
      const result = await reportsApi.reportContent({
        entityType: target.entityType,
        entityId: target.entityId,
        reason: selectedReason,
      });
      if (result.alreadyReported) {
        showToast(
          "info",
          "Already reported",
          "Our team is already reviewing this.",
        );
      } else {
        showToast(
          "success",
          "Report sent",
          "Thank you. Our team reviews every report within 24 hours.",
        );
      }
      closeReportSheet();
    } catch (err: any) {
      showToast(
        "error",
        "Couldn't file report",
        err?.message || "Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [target, selectedReason, submitting, showToast, closeReportSheet]);

  const headerSubtitle = useMemo(() => {
    if (!target) return "";
    const labelPart = target.label ? ` ${target.label}` : "";
    switch (target.entityType) {
      case "post":
        return `Reporting post${labelPart}`;
      case "comment":
        return `Reporting comment${labelPart}`;
      case "event":
        return `Reporting event${labelPart}`;
      case "story":
        return `Reporting story${labelPart}`;
      case "profile":
        return `Reporting${labelPart || " user"}`;
      case "message":
        return `Reporting message${labelPart}`;
      default:
        return `Reporting${labelPart}`;
    }
  }, [target]);

  if (!visible) return null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{
        backgroundColor: colors.mutedForeground,
        width: 40,
      }}
      style={{ zIndex: 10000, elevation: 10000 }}
    >
      <BottomSheetView style={styles.content}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerTitleRow}>
            <Flag size={18} color={colors.foreground} />
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Report
            </Text>
          </View>
          <Pressable onPress={closeReportSheet} hitSlop={12}>
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        <Text
          style={[
            styles.subtitle,
            { color: colors.mutedForeground },
          ]}
        >
          {headerSubtitle}. Reports are anonymous to the person you report.
        </Text>

        <View style={styles.reasonList}>
          {REPORT_REASON_OPTIONS.map((option) => {
            const isSelected = selectedReason === option.value;
            return (
              <Pressable
                key={option.value}
                onPress={() => setSelectedReason(option.value)}
                style={[
                  styles.reasonRow,
                  { borderBottomColor: colors.border },
                  isSelected && { backgroundColor: `${colors.primary}14` },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
              >
                <Text
                  style={[styles.reasonLabel, { color: colors.foreground }]}
                >
                  {option.label}
                </Text>
                {isSelected ? (
                  <Check size={20} color={colors.primary} />
                ) : null}
              </Pressable>
            );
          })}
        </View>

        <View style={styles.footer}>
          <Pressable
            onPress={handleSubmit}
            disabled={!selectedReason || submitting}
            style={[
              styles.submitButton,
              {
                backgroundColor:
                  !selectedReason || submitting
                    ? `${colors.primary}55`
                    : colors.primary,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Submit report"
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitText}>Submit report</Text>
            )}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 13,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 6,
    lineHeight: 18,
  },
  reasonList: {
    paddingTop: 8,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reasonLabel: {
    fontSize: 16,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  submitButton: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
