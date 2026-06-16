"use client";

import { useEffect } from "react";

/**
 * Warn before leaving a dirty form (web). Registers a `beforeunload` handler so
 * a browser tab-close / reload prompts; pair with `StickySaveBar` for in-app
 * affordance. Native sibling (`useDirtyGuard.ts`) is a no-op shell.
 *
 * @param isDirty whether the form has unsaved changes.
 */
export function useDirtyGuard(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);
}

/** Shallow-compare two flat form-state objects to derive `isDirty`. */
export function isFormDirty<T extends Record<string, unknown>>(
  initial: T,
  current: T,
): boolean {
  for (const k of Object.keys(initial)) {
    if (initial[k] !== current[k]) return true;
  }
  return false;
}
