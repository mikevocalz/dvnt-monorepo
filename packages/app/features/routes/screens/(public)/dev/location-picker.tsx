import { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import {
  LocationAutocompleteInstagram,
  type LocationData,
} from "@dvnt/app/components/ui/location-autocomplete-instagram";

export default function PublicLocationPickerPreviewScreen() {
  const router = useRouter();
  const { query } = useLocalSearchParams<{ query?: string }>();
  const initialQuery = useMemo(
    () => (typeof query === "string" && query.trim() ? query.trim() : "Times Square"),
    [query],
  );
  const [value, setValue] = useState(initialQuery);
  const [selected, setSelected] = useState<LocationData | null>(null);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={styles.title}>Location Picker Preview</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.kicker}>DEV PREVIEW</Text>
        <Text style={styles.copy}>
          This screen auto-opens the new sheet-based location picker so the
          physical-device path can be verified without an authenticated event or post flow.
        </Text>

        <LocationAutocompleteInstagram
          value={value}
          placeholder="Search venue or address"
          autoOpen
          onLocationSelect={(location) => {
            setValue(location.formattedAddress || location.name);
            setSelected(location);
          }}
          onTextChange={(text) => {
            setValue(text);
          }}
          onClear={() => {
            setValue("");
            setSelected(null);
          }}
        />

        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Selection</Text>
          <Text style={styles.summaryValue}>{selected?.name || "None yet"}</Text>
          <Text style={styles.summaryMeta}>
            {selected?.formattedAddress || value || "No typed query"}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  title: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 14,
  },
  kicker: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
  },
  copy: {
    color: "rgba(228,228,231,0.78)",
    fontSize: 14,
    lineHeight: 20,
  },
  summary: {
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 16,
    gap: 6,
  },
  summaryTitle: {
    color: "rgba(255,255,255,0.52)",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  summaryValue: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "700",
  },
  summaryMeta: {
    color: "rgba(228,228,231,0.7)",
    fontSize: 13,
    lineHeight: 18,
  },
});
