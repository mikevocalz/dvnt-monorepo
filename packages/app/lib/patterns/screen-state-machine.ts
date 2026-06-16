/**
 * Screen State Machine Pattern
 * 
 * Prevents bootstrap/mount loops by enforcing explicit state transitions.
 * Use for screens that fetch/create data on mount.
 * 
 * CRITICAL: Prevents infinite loops from:
 * - Repeated bootstrap attempts
 * - Circular state dependencies
 * - Race conditions during mount
 */

import { useState, useEffect, useRef, useCallback } from "react";

export type ScreenPhase =
  | "idle"
  | "validating"
  | "bootstrapping"
  | "loading"
  | "ready"
  | "empty"
  | "forbidden"
  | "error";

export interface ScreenStateMachine {
  phase: ScreenPhase;
  error: string | null;
  transitionTo: (newPhase: ScreenPhase, error?: string) => void;
  isPhase: (phase: ScreenPhase) => boolean;
  canTransition: (from: ScreenPhase, to: ScreenPhase) => boolean;
  reset: () => void;
}

/**
 * Valid state transitions to prevent invalid flows.
 */
const VALID_TRANSITIONS: Record<ScreenPhase, ScreenPhase[]> = {
  idle: ["validating", "loading", "error"],
  validating: ["bootstrapping", "loading", "forbidden", "error"],
  bootstrapping: ["loading", "error"],
  loading: ["ready", "empty", "error"],
  ready: ["loading", "error"], // Allow refresh
  empty: ["loading", "error"], // Allow retry
  forbidden: ["idle"], // Allow reset
  error: ["idle", "loading"], // Allow retry
};

/**
 * Screen state machine hook.
 * 
 * @example
 * const { phase, transitionTo, isPhase } = useScreenStateMachine("idle");
 * 
 * useEffect(() => {
 *   if (phase !== "idle") return;
 *   transitionTo("loading");
 *   fetchData().then(() => transitionTo("ready"));
 * }, [phase]);
 * 
 * if (isPhase("loading")) return <Skeleton />;
 * if (isPhase("error")) return <Error />;
 * if (isPhase("ready")) return <Content />;
 */
export function useScreenStateMachine(
  initialPhase: ScreenPhase = "idle"
): ScreenStateMachine {
  const [phase, setPhase] = useState<ScreenPhase>(initialPhase);
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const canTransition = useCallback(
    (from: ScreenPhase, to: ScreenPhase): boolean => {
      const validNextStates = VALID_TRANSITIONS[from];
      return validNextStates.includes(to);
    },
    []
  );

  const transitionTo = useCallback(
    (newPhase: ScreenPhase, errorMsg?: string) => {
      const currentPhase = phaseRef.current;

      // Prevent no-op transitions
      if (currentPhase === newPhase) {
        if (__DEV__) {
          console.log(`[StateMachine] No-op transition: ${newPhase}`);
        }
        return;
      }

      // Validate transition
      if (!canTransition(currentPhase, newPhase)) {
        console.error(
          `[StateMachine] Invalid transition: ${currentPhase} → ${newPhase}`
        );
        return;
      }

      if (__DEV__) {
        console.log(`[StateMachine] ${currentPhase} → ${newPhase}`);
      }

      setPhase(newPhase);
      setError(errorMsg || null);
    },
    [canTransition]
  );

  const isPhase = useCallback(
    (checkPhase: ScreenPhase) => phase === checkPhase,
    [phase]
  );

  const reset = useCallback(() => {
    if (__DEV__) {
      console.log(`[StateMachine] Reset: ${phaseRef.current} → idle`);
    }
    setPhase("idle");
    setError(null);
  }, []);

  return {
    phase,
    error,
    transitionTo,
    isPhase,
    canTransition,
    reset,
  };
}

/**
 * Guard hook to prevent duplicate bootstrap attempts.
 * 
 * @example
 * const { shouldBootstrap, markBootstrapped } = useBootstrapGuard();
 * 
 * useEffect(() => {
 *   if (!shouldBootstrap()) return;
 *   
 *   createConversation().then(() => {
 *     markBootstrapped();
 *   });
 * }, []);
 */
export function useBootstrapGuard() {
  const hasBootstrappedRef = useRef(false);
  const isBootstrappingRef = useRef(false);

  const shouldBootstrap = useCallback(() => {
    if (hasBootstrappedRef.current || isBootstrappingRef.current) {
      if (__DEV__) {
        console.log("[BootstrapGuard] Preventing duplicate bootstrap");
      }
      return false;
    }
    isBootstrappingRef.current = true;
    return true;
  }, []);

  const markBootstrapped = useCallback(() => {
    hasBootstrappedRef.current = true;
    isBootstrappingRef.current = false;
  }, []);

  const reset = useCallback(() => {
    hasBootstrappedRef.current = false;
    isBootstrappingRef.current = false;
  }, []);

  return {
    shouldBootstrap,
    markBootstrapped,
    reset,
  };
}
