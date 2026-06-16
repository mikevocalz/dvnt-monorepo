import type { ReactNode } from "react";
import { Modal, View, Pressable } from "react-native";
import { X } from "lucide-react-native";
import { Text } from "react-native";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  side?: "right" | "left" | "bottom";
  size?: number;
  hideClose?: boolean;
}

/**
 * Native drawer — RN Modal sliding from an edge. Mirror of `Drawer.web.tsx`;
 * native screens typically prefer @gorhom BottomSheet, but this keeps the
 * universal kit import resolvable.
 */
export function Drawer({ open, onClose, title, children, footer, side = "right", hideClose }: DrawerProps) {
  const isBottom = side === "bottom";
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: isBottom ? "flex-end" : "center", alignItems: isBottom ? "stretch" : side === "left" ? "flex-start" : "flex-end" }}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: "#101321",
            borderColor: "rgba(255,255,255,0.1)",
            borderWidth: 1,
            ...(isBottom
              ? { borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "85%" }
              : { width: 420, maxWidth: "92%", height: "100%", borderTopLeftRadius: 24, borderBottomLeftRadius: 24 }),
          }}
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
