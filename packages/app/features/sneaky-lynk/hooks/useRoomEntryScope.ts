import { useCallback, useEffect, useRef, useState } from "react";

/** A render-time boundary around the effect-driven, shared room UI store.
 * A previous account's connected phase must never mount a new account's room
 * before the parent lookup effect resets that store. Lifecycle state stays local.
 */
export function useRoomEntryScope(scope: string) {
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const initializedRef = useRef<string | null>(null);
  const mounted = useRef(true);
  const [initializedScope, setInitializedScope] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const initialize = useCallback(() => {
    if (!mounted.current || currentScope.current !== scope) return;
    initializedRef.current = scope;
    setInitializedScope(scope);
  }, [scope]);
  const isCurrent = useCallback(() => mounted.current && currentScope.current === scope && initializedRef.current === scope, [scope]);
  return { ready: initializedScope === scope, initialize, isCurrent };
}
