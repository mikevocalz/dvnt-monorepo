/**
 * Eject Modal Component
 * Shown when user is kicked or banned from a room.
 *
 * Open/close contract (matches every other Sneaky Lynk sheet):
 *   - Parent owns `visible`. Sheet's `index` is driven from it via
 *     `visible ? 0 : -1`. A ref-driven useEffect nudges snapToIndex /
 *     close to keep internal animation state in sync when the parent
 *     flips the prop fast.
 *   - All hooks are called unconditionally every render. An early
 *     return before a hook violates rules-of-hooks and is what caused
 *     prior sheets to render stuck. No early returns here.
 */

import { useCallback, useEffect, useRef } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ShieldX, Ban } from "lucide-react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import type { EjectPayload } from "../types";

interface EjectModalProps {
  visible: boolean;
  payload: EjectPayload | null;
  onDismiss: () => void;
}

export function EjectModal({ visible, payload, onDismiss }: EjectModalProps) {
  const { colors } = useColorScheme();
  const sheetRef = useRef<BottomSheet>(null);
  const isBan = payload?.action === "ban";

  // Keep the sheet animation in sync with the parent's `visible` flag.
  // Without this, rapidly toggling visible (eject → ack → re-eject)
  // leaves the sheet mounted at index -1 with stale animation state.
  useEffect(() => {
    if (visible && payload) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible, payload]);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.7}
        pressBehavior="none"
      />
    ),
    [],
  );

  // Guard content — we still want the BottomSheet mounted so the
  // snapToIndex/close imperative path keeps working, but we skip the
  // inner payload-dependent body when there's nothing to show.
  const shouldRenderBody = !!payload;

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible && payload ? 0 : -1}
      animateOnMount
      enableDynamicSizing
      enablePanDownToClose={false}
      backdropComponent={renderBackdrop}
      onChange={handleSheetChange}
      backgroundStyle={{
        backgroundColor: colors.secondary,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
      }}
      handleIndicatorStyle={{
        backgroundColor: `${colors.foreground}30`,
        width: 44,
      }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <BottomSheetView>
        {/* Sheet header — title + subtitle sit in a dedicated header
            row (with hairline divider) so the sheet reads like every
            other Sneaky Lynk sheet. No X close here; eject is modal
            by design and the user must tap "Leave Room" to acknowledge. */}
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border },
          ]}
        >
          <View
            style={[
              styles.headerIcon,
              {
                backgroundColor: isBan
                  ? `${colors.destructive}1f`
                  : "rgba(249, 115, 22, 0.2)",
                borderColor: isBan
                  ? `${colors.destructive}40`
                  : "rgba(249, 115, 22, 0.4)",
              },
            ]}
          >
            {isBan ? (
              <Ban size={22} color={colors.destructive} />
            ) : (
              <ShieldX size={22} color="#F97316" />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.headerTitle, { color: colors.foreground }]}
            >
              {isBan ? "You've been banned" : "You've been removed"}
            </Text>
            <Text
              style={[styles.headerSub, { color: colors.mutedForeground }]}
            >
              {isBan
                ? "You can't rejoin this room."
                : "A moderator removed you from this room."}
            </Text>
          </View>
        </View>

        {shouldRenderBody ? (
          <View style={styles.body}>
            {payload?.reason ? (
              <View
                style={[
                  styles.reasonBox,
                  {
                    backgroundColor: `${colors.foreground}08`,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.reasonLabel,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Reason
                </Text>
                <Text
                  style={[styles.reasonText, { color: colors.foreground }]}
                >
                  {payload.reason}
                </Text>
              </View>
            ) : null}

            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.leaveBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.leaveLabel,
                  { color: colors.primaryForeground },
                ]}
              >
                Leave room
              </Text>
            </Pressable>
          </View>
        ) : null}
      </BottomSheetView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  headerSub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 14,
  },
  reasonBox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  reasonLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  reasonText: {
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  leaveBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  leaveLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
});
