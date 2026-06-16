/**
 * useDebounce hook - delays updating a value until after a specified delay.
 * Uses TanStack Debouncer internally (no setTimeout).
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Debouncer } from "@tanstack/pacer";

export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  const debouncerRef = useRef(
    new Debouncer(setDebouncedValue, { wait: delay }),
  );

  useEffect(() => {
    debouncerRef.current.maybeExecute(value);
  }, [value]);

  useEffect(() => {
    return () => {
      debouncerRef.current.cancel();
    };
  }, []);

  return debouncedValue;
}

/**
 * useDebouncedCallback - returns a debounced version of a callback function.
 * Uses TanStack Debouncer internally (no setTimeout).
 */
export function useDebouncedCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number = 300,
): (...args: Parameters<T>) => void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const debouncerRef = useRef(
    new Debouncer((...args: Parameters<T>) => callbackRef.current(...args), {
      wait: delay,
    }),
  );

  useEffect(() => {
    return () => {
      debouncerRef.current.cancel();
    };
  }, []);

  return useCallback((...args: Parameters<T>) => {
    debouncerRef.current.maybeExecute(...args);
  }, []);
}
