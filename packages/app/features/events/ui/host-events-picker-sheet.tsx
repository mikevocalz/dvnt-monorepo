/**
 * HostEventsPickerSheet — disambiguates "More events" when an event is billed
 * to more than one person.
 *
 * With a single host, "More events" is an unambiguous link and this never
 * opens; a picker holding one option is a decision the user shouldn't be asked
 * to make. With co-hosts, one link would have to silently pick a winner, so the
 * control names everyone instead and lets the reader choose whose events they
 * meant.
 *
 * Every row states its role, because "Host" and "Co-host" are the reason there
 * is a choice at all — an unlabelled list of two people is a question without
 * context.
 *
 * Follows the house sheet contract: inline `BottomSheet` (never the modal
 * portal), the shared detached metrics, and `GlassSheetBackground`.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { ChevronRight, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import {
  useDetachedSheetMetrics,
  SHEET_BOTTOM_INSET,
} from "@dvnt/app/lib/ui/sheet-metrics";
import { GlassSheetBackground } from "@dvnt/app/components/sheets/glass-sheet-background";

export interface HostEntry {
  username: string;
  name: string;
  avatar?: string;
  /** "Host" / "Co-host" — shown verbatim, never inferred. */
  role: string;
}

interface HostEventsPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  hosts: HostEntry[];
  /** Called with the chosen host's username. */
  onSelect: (username: string) => void;
}

export function HostEventsPickerSheet({
  visible,
  onClose,
  hosts,
  onSelect,
}: HostEventsPickerSheetProps) {
  const sheetRef = useRef<BottomSheet>(null);
  const { height: windowHeight } = useWindowDimensions();
  const sheet = useDetachedSheetMetrics();
  // Numeric, not "%": this sheet mounts inside the event page's scroll content,
  // where a percentage resolves against content height, not the viewport.
  const snapPoints = useMemo(() => [sheet.height], [sheet.height]);

  useEffect(() => {
    if (visible) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [visible]);

  const handleSheetChange = useCallback(
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

  const handleSelect = useCallback(
    (username: string) => {
      Haptics.selectionAsync().catch(() => {});
      // Close first so the sheet is not left standing over the destination.
      onClose();
      onSelect(username);
    },
    [onClose, onSelect],
  );

  if (!visible) return null;

  return (
    // OrganizerCard lives inside the event page's ScrollView, so the sheet's
    // own `absoluteFill` host would measure that content, not the screen.
    <View
      pointerEvents="box-none"
      style={[s.viewport, { height: windowHeight }]}
    >
      <BottomSheet
        ref={sheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableOverDrag={false}
        onChange={handleSheetChange}
        backdropComponent={renderBackdrop}
        backgroundComponent={GlassSheetBackground}
        handleIndicatorStyle={s.handle}
        enableDynamicSizing={false}
        detached
        bottomInset={SHEET_BOTTOM_INSET}
        style={{ marginHorizontal: sheet.marginHorizontal }}
      >
        <BottomSheetView style={s.content}>
          <View style={s.header}>
            <Text style={s.title}>Whose events?</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={s.close}
            >
              <X size={18} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
          <Text style={s.subtitle}>
            This event is hosted by more than one person.
          </Text>

          {hosts.map((host) => (
            <Pressable
              key={host.username}
              onPress={() => handleSelect(host.username)}
              style={({ pressed }) => [s.row, pressed && s.rowPressed]}
              accessibilityRole="button"
              accessibilityLabel={`${host.name}, ${host.role}. See their events`}
            >
              <Avatar uri={host.avatar} username={host.username} size={44} />
              <View style={s.rowText}>
                <Text style={s.rowName} numberOfLines={1}>
                  {host.name}
                </Text>
                <Text style={s.rowHandle} numberOfLines={1}>
                  @{host.username}
                </Text>
              </View>
              <View style={s.rolePill}>
                <Text style={s.roleText}>{host.role}</Text>
              </View>
              <ChevronRight size={18} color="rgba(255,255,255,0.4)" />
            </Pressable>
          ))}
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}

const ACCENT = "#3FDCFF";

const s = StyleSheet.create({
  // Bottom-anchored with an explicit viewport height, so the sheet rises from
  // the screen edge instead of the bottom of the scrolled page.
  viewport: { position: "absolute", left: 0, right: 0, bottom: 0 },
  handle: { backgroundColor: "rgba(255,255,255,0.25)", width: 40 },
  content: { paddingHorizontal: 18, paddingBottom: 28, gap: 4 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  close: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  subtitle: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderCurve: "continuous",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginTop: 8,
  },
  rowPressed: { backgroundColor: "rgba(255,255,255,0.08)" },
  rowText: { flex: 1, flexShrink: 1 },
  rowName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  rowHandle: { color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 2 },
  rolePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderCurve: "continuous",
    backgroundColor: "rgba(63,220,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(63,220,255,0.25)",
  },
  roleText: {
    color: ACCENT,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
