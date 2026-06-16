"use client";

import type { ReactNode } from "react";

export interface FormFieldProps {
  /** Field label (the visible question). */
  label?: string;
  /** Helper text under the control. */
  description?: string;
  /** Validation error — when set, the control is outlined red and this shows. */
  error?: string;
  /** Marks the field required (renders a subtle asterisk). */
  required?: boolean;
  /** Associates the label with the control for a11y. */
  htmlFor?: string;
  /** The control (input / textarea / select / switch row). */
  children: ReactNode;
  /** Extra classes on the wrapper. */
  className?: string;
}

/**
 * Web form field — label + control + description/error, the atomic unit of every
 * ported settings/edit form (Law 3: "labeled fields"). Styling is raw Tailwind
 * because NativeWind interop is off on this Next build; the native sibling
 * (`FormField.tsx`) uses RN primitives.
 */
export function FormField({
  label,
  description,
  error,
  required,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-sm font-semibold text-white/90 select-none"
        >
          {label}
          {required ? <span className="text-rose-400 ml-0.5">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="text-xs text-rose-400">{error}</span>
      ) : description ? (
        <span className="text-xs text-white/40">{description}</span>
      ) : null}
    </div>
  );
}
