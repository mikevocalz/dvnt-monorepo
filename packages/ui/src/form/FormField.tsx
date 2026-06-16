import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "react-native";

export interface FormFieldProps {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Native form field — label + control + description/error. Mirror of
 * `FormField.web.tsx`; resolved per platform via the barrel.
 */
export function FormField({
  label,
  description,
  error,
  required,
  children,
}: FormFieldProps) {
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ fontSize: 14, fontWeight: "600", color: "rgba(255,255,255,0.9)" }}>
          {label}
          {required ? <Text style={{ color: "#fb7185" }}> *</Text> : null}
        </Text>
      ) : null}
      {children}
      {error ? (
        <Text style={{ fontSize: 12, color: "#fb7185" }}>{error}</Text>
      ) : description ? (
        <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>{description}</Text>
      ) : null}
    </View>
  );
}
