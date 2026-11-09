import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Crown, Users } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CapacityDetail } from "../errors";

interface RoomFullSheetProps {
  visible: boolean;
  capacity: CapacityDetail | null;
  retrying?: boolean;
  automatic?: boolean;
  secondsUntilRetry?: number;
  cooldownSeconds?: number;
  onStartAutomatic?: () => void;
  onStopAutomatic?: () => void;
  onClose: () => void;
  /** Explicit retry through the real room join, preserving identity choices. */
  onSeatOpen: () => void;
  onUpgrade: () => void;
  onPayToJoin?: () => void;
}

/** Capacity is a server verdict, not a reservation or a notification service. */
export function RoomFullSheet({ visible, capacity, retrying = false, automatic = false, secondsUntilRetry = 0, cooldownSeconds = 0, onStartAutomatic, onStopAutomatic, onClose, onSeatOpen, onUpgrade, onPayToJoin }: RoomFullSheetProps) {
  const insets = useSafeAreaInsets();
  const isHost = !!capacity?.isHost;
  const showCount = !!capacity && Number.isFinite(capacity.max) && capacity.max > 0 && Number.isFinite(capacity.current) && capacity.current >= 0;
  const accent = isHost ? "#FF5BFC" : "#3FDCFF";
  const retryDisabled = retrying || (!isHost && cooldownSeconds > 0);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <ScrollView style={styles.backdrop} contentContainerStyle={{ flexGrow: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={[styles.icon, { backgroundColor: `${accent}14` }]}>{isHost ? <Crown size={28} color={accent} /> : <Users size={28} color={accent} />}</View>
          <Text style={styles.eyebrow}>AT CAPACITY</Text>
          <Text accessibilityRole="header" style={styles.title}>{isHost ? "Your room is full" : "This Lynk is full"}</Text>
          {showCount ? <Text style={styles.count}>{capacity!.current} / {capacity!.max} <Text style={styles.countLabel}>seats at last check</Text></Text> : null}
          <Text style={styles.body}>{isHost ? "You've reached your plan's seat limit. View plans for larger rooms, or return to your Lynks." : "There isn't a seat available right now. Try again in a moment. Your camera, microphone and anonymous-profile choices will stay the same."}</Text>
          <Pressable accessibilityRole="button" accessibilityState={{ disabled: retryDisabled, busy: retrying }} disabled={retryDisabled} onPress={isHost ? onUpgrade : onSeatOpen} style={({ pressed }) => [styles.primary, { backgroundColor: accent, opacity: retryDisabled || pressed ? 0.65 : 1 }]}>
            {retrying ? <ActivityIndicator size="small" color="#06070D" /> : null}
            <Text style={styles.primaryLabel}>{retrying ? "Trying again…" : isHost ? "View plans" : cooldownSeconds > 0 ? `Try again in ${cooldownSeconds}s` : "Try again"}</Text>
          </Pressable>
          {!isHost && onStartAutomatic ? <>
            <Text accessibilityLiveRegion="polite" style={styles.retryStatus}>{automatic ? retrying ? "Trying to join with your reviewed settings…" : `Next attempt in ${secondsUntilRetry}s. Retries slow from 5 to 30 seconds.` : retrying ? "The current request is finishing. No further automatic attempts are scheduled." : "Choose automatic retries to join when a request succeeds, using the same settings. Retries stop when you leave this screen or switch away from the app. A seat is not reserved."}</Text>
            <Pressable accessibilityRole="button" disabled={!automatic && retrying} onPress={automatic ? onStopAutomatic : onStartAutomatic} style={({ pressed }) => [styles.secondary, { opacity: (!automatic && retrying) || pressed ? 0.65 : 1 }]}>
              <Text style={styles.secondaryLabel}>{automatic ? "Stop trying automatically" : "Try automatically"}</Text>
            </Pressable>
          </> : null}
          {!isHost && onPayToJoin ? <Pressable accessibilityRole="button" disabled={retrying} onPress={onPayToJoin} style={styles.secondary}><Text style={{ color: accent, fontWeight: "600", fontSize: 14 }}>View access options</Text></Pressable> : null}
          <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.secondary, { opacity: pressed ? 0.65 : 1 }]}><Text style={styles.secondaryLabel}>Back to Lynks</Text></Pressable>
        </View>
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(2,3,10,0.82)" },
  card: { width: "100%", maxWidth: 420, borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", backgroundColor: "#0D1019", padding: 24, alignItems: "center", gap: 12 },
  icon: { width: 64, height: 64, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  eyebrow: { color: "#AEB3C2", fontSize: 11, letterSpacing: 1.6, fontWeight: "600" },
  title: { color: "#fff", fontSize: 24, fontWeight: "700", letterSpacing: -0.4, textAlign: "center" },
  count: { color: "#fff", fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"], textAlign: "center" },
  countLabel: { color: "#AEB3C2", fontSize: 12, fontWeight: "400" },
  body: { color: "#B7B9C5", fontSize: 14, lineHeight: 21, textAlign: "center", marginBottom: 8 },
  retryStatus: { color: "#AEB3C2", fontSize: 12, lineHeight: 18, textAlign: "center" },
  primary: { width: "100%", minHeight: 52, borderRadius: 8, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", padding: 12 },
  primaryLabel: { color: "#06070D", fontSize: 15, fontWeight: "700" },
  secondary: { width: "100%", minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", padding: 12 },
  secondaryLabel: { color: "#D3D5DE", fontSize: 14, fontWeight: "600" },
});
