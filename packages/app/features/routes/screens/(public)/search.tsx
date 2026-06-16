import { useLocalSearchParams } from "expo-router";
import { View, Text, StyleSheet } from "react-native";
import { Search } from "lucide-react-native";
import { PublicLockedScreen } from "@dvnt/app/components/access/PublicLockedScreen";

export default function PublicSearchScreen() {
  const { query } = useLocalSearchParams<{ query?: string }>();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Search size={22} color="#fff" />
        </View>
        <Text style={styles.title}>Search preview</Text>
        <Text style={styles.description}>
          {typeof query === "string" && query.length > 0
            ? `Search for ${query} unlocks after signup.`
            : "Search stays protected until you create an account."}
        </Text>
      </View>

      <PublicLockedScreen reason="search" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 8,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
  },
  description: {
    color: "rgba(228,228,231,0.72)",
    fontSize: 14,
    lineHeight: 20,
  },
});
