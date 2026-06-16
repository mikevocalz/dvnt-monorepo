import React from "react";
import { Platform } from "react-native";
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
} from "react-native-keyboard-controller";

/**
 * Standard keyboard-safe scrollable form container.
 *
 * Wraps react-native-keyboard-controller's KeyboardAwareScrollView with
 * production-grade defaults so every form screen behaves consistently:
 * - Auto-scrolls to focused input
 * - keyboardShouldPersistTaps="handled" (buttons work while keyboard is open)
 * - keyboardDismissMode="interactive" on iOS for drag-to-dismiss
 * - bottomOffset ensures CTA buttons remain visible above keyboard
 *
 * Usage:
 * ```tsx
 * <KeyboardSafeScrollView>
 *   <TextInput />
 *   <Button title="Submit" />
 * </KeyboardSafeScrollView>
 * ```
 */
export const KeyboardSafeScrollView = React.forwardRef<
  any,
  KeyboardAwareScrollViewProps & { children: React.ReactNode }
>(({ children, bottomOffset = 40, ...rest }, ref) => {
  return (
    <KeyboardAwareScrollView
      ref={ref}
      bottomOffset={bottomOffset}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
      showsVerticalScrollIndicator={false}
      {...rest}
    >
      {children}
    </KeyboardAwareScrollView>
  );
});

KeyboardSafeScrollView.displayName = "KeyboardSafeScrollView";
