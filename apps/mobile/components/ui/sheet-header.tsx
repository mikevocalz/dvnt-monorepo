import { View, Text, Pressable, StyleSheet } from "react-native";
import { ChevronLeft, X } from "lucide-react-native";

const DVNT_FUCHSIA = "rgb(255, 109, 193)";

interface SheetHeaderProps {
  title: string;
  onClose: () => void;
  onBack?: () => void;
}

export function SheetHeader({ title, onClose, onBack }: SheetHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.leading}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.backButton}
          >
            <ChevronLeft size={22} color="#fff" />
          </Pressable>
        ) : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      <Pressable
        onPress={onClose}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={styles.closeButton}
      >
        <X size={22} color={DVNT_FUCHSIA} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  leading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexShrink: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#34A2DF",
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
});
