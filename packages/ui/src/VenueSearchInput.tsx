import { memo, useCallback } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  LegendList,
  type LegendListRenderItemProps,
} from "@legendapp/list";

export interface VenuePrediction {
  placeId: string;
  mainText: string;
  secondaryText?: string;
  fullText?: string;
}

export interface VenueSearchInputProps {
  value: string;
  predictions: VenuePrediction[];
  placeholder?: string;
  isLoading?: boolean;
  isSelecting?: boolean;
  error?: string | null;
  showDropdown?: boolean;
  emptyText?: string;
  onChangeText: (text: string) => void;
  onSelectPrediction: (prediction: VenuePrediction) => void;
  onClear?: () => void;
  onFocus?: () => void;
  style?: StyleProp<ViewStyle>;
}

const PredictionRow = memo(function PredictionRow({
  item,
  onPress,
}: {
  item: VenuePrediction;
  onPress: (prediction: VenuePrediction) => void;
}) {
  const handlePress = useCallback(() => onPress(item), [item, onPress]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.mainText}${item.secondaryText ? `, ${item.secondaryText}` : ""}`}
      onPress={handlePress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.pin}>
        <Text style={styles.pinText}>P</Text>
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.mainText}>
          {item.mainText}
        </Text>
        {item.secondaryText || item.fullText ? (
          <Text numberOfLines={1} style={styles.secondaryText}>
            {item.secondaryText || item.fullText}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
});

function keyExtractor(item: VenuePrediction) {
  return item.placeId;
}

export function VenueSearchInput({
  value,
  predictions,
  placeholder = "Search venue or address",
  isLoading = false,
  isSelecting = false,
  error,
  showDropdown = false,
  emptyText = "No nearby venues or addresses found",
  onChangeText,
  onSelectPrediction,
  onClear,
  onFocus,
  style,
}: VenueSearchInputProps) {
  const renderItem = useCallback(
    ({ item }: LegendListRenderItemProps<VenuePrediction>) => (
      <PredictionRow item={item} onPress={onSelectPrediction} />
    ),
    [onSelectPrediction],
  );

  const showResults = showDropdown && value.trim().length >= 2;

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.inputWrap}>
        <Text style={styles.leadingIcon}>@</Text>
        <TextInput
          accessibilityLabel="Venue or address"
          value={value}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor="rgba(255,255,255,0.42)"
          autoCorrect={false}
          autoCapitalize="words"
          style={styles.input}
        />
        {isLoading || isSelecting ? (
          <ActivityIndicator size="small" color="#3FDCFF" />
        ) : value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear venue search"
            onPress={onClear}
            hitSlop={10}
            style={styles.clearButton}
          >
            <Text style={styles.clearText}>x</Text>
          </Pressable>
        ) : null}
      </View>

      {showResults ? (
        <View style={styles.dropdown}>
          {error ? (
            <Text style={styles.stateText}>{error}</Text>
          ) : predictions.length > 0 ? (
            <LegendList
              data={predictions}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              estimatedItemSize={64}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          ) : !isLoading ? (
            <Text style={styles.stateText}>{emptyText}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    zIndex: 20,
  },
  inputWrap: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.055)",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  leadingIcon: {
    color: "#3FDCFF",
    fontSize: 18,
    fontWeight: "700",
  },
  input: {
    flex: 1,
    minHeight: 46,
    color: "#FFFFFF",
    fontSize: 15,
    paddingVertical: 0,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  clearText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 20,
    lineHeight: 22,
  },
  dropdown: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#10121B",
    overflow: "hidden",
    maxHeight: 280,
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  list: {
    maxHeight: 280,
  },
  row: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  rowPressed: {
    backgroundColor: "rgba(63,220,255,0.08)",
  },
  pin: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(63,220,255,0.12)",
  },
  pinText: {
    color: "#3FDCFF",
    fontWeight: "800",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  mainText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  secondaryText: {
    marginTop: 3,
    color: "rgba(255,255,255,0.58)",
    fontSize: 12,
  },
  stateText: {
    padding: 14,
    color: "rgba(255,255,255,0.62)",
    fontSize: 13,
  },
});
