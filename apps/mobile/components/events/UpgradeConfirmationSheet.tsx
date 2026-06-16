import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { ArrowUp, X } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import type { UpgradeTierOption } from "@/lib/hooks/use-ticket-upgrade";

interface UpgradeConfirmationSheetProps {
  visible: boolean;
  option: UpgradeTierOption | null;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function UpgradeConfirmationSheet({
  visible,
  option,
  onClose,
  onConfirm,
  isPending,
}: UpgradeConfirmationSheetProps) {
  const { colors } = useColorScheme();
  const ref = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["40%"], []);

  useEffect(() => {
    if (visible) {
      ref.current?.snapToIndex(0);
    } else {
      ref.current?.close();
    }
  }, [visible]);

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
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

  if (!visible || !option) return null;

  return (
    <BottomSheet
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={handleChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.card }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground, width: 40 }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <BottomSheetView style={styles.content}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Upgrade Ticket
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={styles.body}>
          <View style={[styles.tierBadge, { backgroundColor: colors.muted }]}>
            <ArrowUp size={16} color="#8A40CF" />
            <Text style={[styles.tierName, { color: colors.foreground }]}>
              {option.tier.name}
            </Text>
          </View>

          <Text style={[styles.priceLine, { color: colors.foreground }]}>
            You'll pay{" "}
            <Text style={styles.priceAmount}>{formatCents(option.diffCents)}</Text>
          </Text>
          <Text style={[styles.subText, { color: colors.mutedForeground }]}>
            This is the difference between your current ticket and {option.tier.name} (
            {formatCents(option.tier.price_cents)} total).
          </Text>
          <Text style={[styles.subText, { color: colors.mutedForeground }]}>
            You'll be redirected to Stripe to complete the upgrade.
          </Text>
        </View>

        <Pressable
          onPress={onConfirm}
          disabled={isPending}
          style={[styles.button, isPending && styles.buttonDisabled]}
        >
          {isPending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.buttonText}>
              Pay {formatCents(option.diffCents)} to Upgrade
            </Text>
          )}
        </Pressable>
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: "600" },
  body: { paddingHorizontal: 20, paddingTop: 20, gap: 10 },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tierName: { fontSize: 15, fontWeight: "600" },
  priceLine: { fontSize: 20, fontWeight: "700", marginTop: 4 },
  priceAmount: { color: "#8A40CF" },
  subText: { fontSize: 13, lineHeight: 18 },
  button: {
    marginHorizontal: 20,
    marginTop: 20,
    backgroundColor: "#8A40CF",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
