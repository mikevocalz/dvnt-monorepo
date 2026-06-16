import React from "react";
import { Pressable, type ViewStyle } from "react-native";
import { KeyboardController } from "react-native-keyboard-controller";

/**
 * Tap-outside-to-dismiss keyboard wrapper.
 *
 * Wraps children in a Pressable that dismisses the keyboard when tapped
 * on non-interactive areas. Uses KeyboardController.dismiss() from
 * react-native-keyboard-controller (not Keyboard.dismiss() from RN).
 *
 * Usage:
 * ```tsx
 * <DismissKeyboardWrapper style={{ flex: 1 }}>
 *   <TextInput />
 * </DismissKeyboardWrapper>
 * ```
 */
export function DismissKeyboardWrapper({
  children,
  style,
  disabled,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        if (!disabled) {
          KeyboardController.dismiss();
        }
      }}
      style={[{ flex: 1 }, style]}
      accessible={false}
    >
      {children}
    </Pressable>
  );
}
