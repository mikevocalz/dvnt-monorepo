import type { ReactNode } from "react";
import { Modal, View, Pressable } from "react-native";
import { X } from "lucide-react-native";
import { Text } from "react-native";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  hideClose?: boolean;
}

/** Native centered dialog (RN Modal). Mirror of `Dialog.web.tsx`. */
export function Dialog({ open, onClose, title, children, footer, hideClose }: DialogProps) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 16 }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ width: "100%", maxWidth: 520, borderRadius: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "#101321", overflow: "hidden" }}
        >
          {title || !hideClose ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff" }}>{title}</Text>
              {!hideClose ? (
                <Pressable onPress={onClose} style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" }}>
                  <X size={18} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>{children}</View>
          {footer ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)" }}>
              {footer}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
