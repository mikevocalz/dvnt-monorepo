import React from "react";
import {
  KeyboardStickyView,
  type KeyboardStickyViewProps,
} from "react-native-keyboard-controller";

/**
 * Sticky footer that tracks keyboard position.
 *
 * Wraps react-native-keyboard-controller's KeyboardStickyView with
 * sensible defaults for composer bars, action footers, and submit rows.
 *
 * The view automatically follows the keyboard up/down with native
 * animation driven by the keyboard-controller event system — no manual
 * Animated values, no padding hacks, no magic numbers.
 *
 * Usage:
 * ```tsx
 * <View style={{ flex: 1 }}>
 *   <ScrollView>...</ScrollView>
 *   <KeyboardStickyFooter>
 *     <TextInput placeholder="Type a message..." />
 *     <Button title="Send" />
 *   </KeyboardStickyFooter>
 * </View>
 * ```
 */
export const KeyboardStickyFooter = React.forwardRef<
  any,
  KeyboardStickyViewProps & { children: React.ReactNode }
>(({ children, offset, ...rest }, ref) => {
  return (
    <KeyboardStickyView
      ref={ref}
      offset={offset ?? { closed: 0, opened: 0 }}
      {...rest}
    >
      {children}
    </KeyboardStickyView>
  );
});

KeyboardStickyFooter.displayName = "KeyboardStickyFooter";
