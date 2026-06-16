import { View, Text, Pressable, StyleSheet } from "react-native";
import { ArrowUp, Lock } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import type { UpgradeTierOption } from "@/lib/hooks/use-ticket-upgrade";

interface UpgradeTierCardProps {
  option: UpgradeTierOption;
  onPress: (option: UpgradeTierOption) => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function UpgradeTierCard({ option, onPress }: UpgradeTierCardProps) {
  const { colors } = useColorScheme();
  const { tier, diffCents, available } = option;
  const soldOut = !available;

  return (
    <Pressable
      onPress={() => !soldOut && onPress(option)}
      disabled={soldOut}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: soldOut ? colors.border : "#8A40CF40",
          opacity: soldOut ? 0.55 : 1,
        },
      ]}
    >
      <View style={styles.left}>
        <View style={[styles.iconBg, { backgroundColor: "#8A40CF20" }]}>
          {soldOut ? (
            <Lock size={14} color="#8A40CF" />
          ) : (
            <ArrowUp size={14} color="#8A40CF" />
          )}
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.foreground }]}>
            {tier.name}
          </Text>
          {tier.description ? (
            <Text style={[styles.desc, { color: colors.mutedForeground }]} numberOfLines={1}>
              {tier.description}
            </Text>
          ) : null}
          {soldOut && (
            <Text style={[styles.desc, { color: "#ef4444" }]}>Sold out</Text>
          )}
        </View>
      </View>
      <View style={styles.right}>
        <Text style={[styles.diff, { color: "#8A40CF" }]}>
          +{formatCents(diffCents)}
        </Text>
        <Text style={[styles.total, { color: colors.mutedForeground }]}>
          {formatCents(tier.price_cents)} total
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  left: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  iconBg: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: "600" },
  desc: { fontSize: 12, marginTop: 2 },
  right: { alignItems: "flex-end", marginLeft: 12 },
  diff: { fontSize: 16, fontWeight: "700" },
  total: { fontSize: 11, marginTop: 2 },
});
