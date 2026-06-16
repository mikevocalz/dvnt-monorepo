import {
  useState,
  createContext,
  useContext,
  ReactNode,
  useRef,
  useCallback,
} from "react";
import {
  View,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
  Platform,
  BackHandler,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { Motion } from "@legendapp/motion";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect } from "react";

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");

interface PopoverContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PopoverContext = createContext<PopoverContextType | undefined>(undefined);

export function usePopover() {
  const context = useContext(PopoverContext);
  if (!context) {
    throw new Error("Popover components must be used within a Popover");
  }
  return context;
}

interface PopoverProps {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function Popover({
  children,
  open: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (value: boolean) => {
    if (!isControlled) {
      setInternalOpen(value);
    }
    onOpenChange?.(value);
  };

  return (
    <PopoverContext.Provider value={{ open, setOpen }}>
      <View style={styles.container}>{children}</View>
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: ReactNode;
  asChild?: boolean;
}

export function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
  const { setOpen, open } = usePopover();

  return <Pressable onPress={() => setOpen(!open)}>{children}</Pressable>;
}

interface PopoverContentProps {
  children: ReactNode | ((props: { onClose: () => void }) => ReactNode);
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}

export function PopoverContent({
  children,
  className,
  align = "center",
  side = "bottom",
}: PopoverContentProps) {
  const { open, setOpen } = usePopover();
  const insets = useSafeAreaInsets();

  const handleClose = useCallback(() => setOpen(false), [setOpen]);

  // Handle Android back button
  useEffect(() => {
    if (!open) return;

    const backHandler = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        handleClose();
        return true;
      },
    );

    return () => backHandler.remove();
  }, [open, handleClose]);

  if (!open) return null;

  // Support both render prop and regular children
  const content =
    typeof children === "function"
      ? children({ onClose: handleClose })
      : children;

  return (
    <>
      {/* Backdrop overlay - positioned absolutely to cover screen */}
      <Pressable style={styles.backdrop} onPress={handleClose} />

      {/* Content dropdown */}
      <Motion.View
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 400 }}
        style={[
          styles.dropdown,
          {
            top: 100 + insets.top,
            maxHeight: SCREEN_HEIGHT - 200 - insets.top - insets.bottom,
          },
        ]}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            <View
              className={`bg-card border border-border rounded-2xl shadow-lg ${className || ""}`}
              style={styles.content}
            >
              {content}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Motion.View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
  },
  backdrop: {
    position: "absolute",
    top: -1000,
    left: -1000,
    right: -1000,
    bottom: -1000,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    zIndex: 9998,
  },
  dropdown: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    backgroundColor: "#1a1a1a",
  },
});
