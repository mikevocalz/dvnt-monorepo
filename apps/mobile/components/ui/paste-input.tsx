/**
 * PasteInput — Drop-in TextInput replacement with image paste support
 *
 * Wraps expo-paste-input's TextInputWrapperView around a standard TextInput.
 * Supports all TextInput props + onPasteImage callback for pasted images.
 * NativeWind className pass-through to the inner TextInput.
 */

import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { TextInputWrapperView, type PasteEventPayload } from "expo-paste-input";

export interface PasteInputProps extends TextInputProps {
  /** Called when user pastes an image from clipboard */
  onPasteImage?: (uris: string[]) => void;
  /** Called when user pastes text from clipboard (optional — default behavior handles text) */
  onPasteText?: (text: string) => void;
}

export const PasteInput = forwardRef<TextInput, PasteInputProps>(
  ({ onPasteImage, onPasteText, style, ...textInputProps }, ref) => {
    const handlePaste = (payload: PasteEventPayload) => {
      switch (payload.type) {
        case "images":
          onPasteImage?.(payload.uris);
          break;
        case "text":
          onPasteText?.(payload.value);
          break;
        case "unsupported":
          break;
      }
    };

    return (
      <TextInputWrapperView onPaste={handlePaste}>
        <TextInput ref={ref} style={[{ flex: 1 }, style]} {...textInputProps} />
      </TextInputWrapperView>
    );
  },
);

PasteInput.displayName = "PasteInput";
