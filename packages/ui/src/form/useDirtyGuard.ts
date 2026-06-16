/**
 * Native dirty-guard shell. On native, navigation-blocking is handled by the
 * router's `beforeRemove` listener at the screen level; this hook keeps the
 * universal import resolvable. The web sibling (`useDirtyGuard.web.ts`) wires a
 * real `beforeunload` guard.
 */
export function useDirtyGuard(_isDirty: boolean): void {
  // no-op on native — screens use navigation.beforeRemove for the prompt.
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
