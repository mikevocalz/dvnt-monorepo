/**
 * RoomJoinErrorSheet
 *
 * Premium error surface shown when a join attempt fails for a reason
 * the user should understand (room full, room ended, rate-limited, etc.).
 * Replaces the previous raw-error-code UX that surfaced backend strings
 * like "Failed to join room" directly to users.
 *
 * Palette is pulled from DVNT's theme (useColorScheme) so it tracks
 * any rebrand automatically.
 *
 * Uses the lightweight `<Modal>` presentation + a DVNT-styled inner
 * card rather than adding another Gorhom sheet — the error surface is
 * modal-blocking by nature (user must acknowledge to dismiss) and we
 * want it to work identically whether the room screen has fully
 * mounted or is still bootstrapping.
 */

import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AlertCircle,
  Users,
  Clock,
  Lock,
  UserX,
  LogIn,
} from "lucide-react-native";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import type {
  ClassifiedError,
  SneakyLynkErrorReason,
} from "../errors";

interface RoomJoinErrorSheetProps {
  error: ClassifiedError | null;
  onDismiss: () => void;
  /** Optional primary action — e.g. "Try again" retries `joinRoom()`. */
  onRetry?: () => void;
  /** Optional — used when error is "unauthorized". */
  onSignIn?: () => void;
}

function iconFor(reason: SneakyLynkErrorReason, color: string) {
  const common = { size: 28, color };
  switch (reason) {
    case "room_full":
      return <Users {...common} />;
    case "room_ended":
      return <Clock {...common} />;
    case "rate_limited":
      return <AlertCircle {...common} />;
    case "forbidden":
      return <Lock {...common} />;
    case "not_found":
      return <UserX {...common} />;
    case "unauthorized":
      return <LogIn {...common} />;
    default:
      return <AlertCircle {...common} />;
  }
}

export function RoomJoinErrorSheet({
  error,
  onDismiss,
  onRetry,
  onSignIn,
}: RoomJoinErrorSheetProps) {
  const { colors } = useColorScheme();
  const visible = !!error;

  // Icon tint — destructive for "things that block you", primary for
  // things that are just informational (ended, full-with-retry).
  const iconTint =
    error?.reason === "forbidden" ||
    error?.reason === "unauthorized" ||
    error?.reason === "rate_limited"
      ? colors.destructive
      : colors.primary;

  const handleCta = () => {
    if (!error) return onDismiss();
    if (error.reason === "unauthorized" && onSignIn) {
      onSignIn();
      return;
    }
    if (error.ctaLabel && onRetry) {
      onRetry();
      return;
    }
    onDismiss();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
            },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: `${iconTint}1f` }, // 12% alpha tint
            ]}
          >
            {error ? iconFor(error.reason, iconTint) : null}
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {error?.title ?? "Something went wrong"}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {error?.body ?? ""}
          </Text>

          <View style={styles.actions}>
            {error?.ctaLabel ? (
              <Pressable
                onPress={handleCta}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.primaryLabel,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {error.ctaLabel}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.secondaryLabel,
                  { color: colors.foreground },
                ]}
              >
                Close
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 22,
    alignItems: "center",
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 18,
  },
  actions: {
    width: "100%",
    gap: 8,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
});
