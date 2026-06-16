import { View, Pressable } from "react-native";
import { Text } from "react-native";

export interface StickySaveBarProps {
  visible: boolean;
  onSave: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  saving?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
}

/** Native sticky save bar — mirror of the web variant. */
export function StickySaveBar({
  visible,
  onSave,
  onCancel,
  disabled,
  saving,
  saveLabel = "Save changes",
  cancelLabel = "Discard",
}: StickySaveBarProps) {
  if (!visible) return null;
  return (
    <View
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 28,
        borderTopWidth: 1,
        borderTopColor: "rgba(255,255,255,0.1)",
        backgroundColor: "rgba(8,10,18,0.92)",
      }}
    >
      <Text style={{ flex: 1, fontSize: 14, color: "rgba(255,255,255,0.5)" }}>
        Unsaved changes
      </Text>
      {onCancel ? (
        <Pressable
          onPress={onCancel}
          disabled={saving}
          style={{ paddingHorizontal: 16, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" }}
        >
          <Text style={{ fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.8)" }}>{cancelLabel}</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onSave}
        disabled={disabled || saving}
        style={{ paddingHorizontal: 20, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#7c3aed", opacity: disabled || saving ? 0.5 : 1 }}
      >
        <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{saving ? "Saving…" : saveLabel}</Text>
      </Pressable>
    </View>
  );
}
