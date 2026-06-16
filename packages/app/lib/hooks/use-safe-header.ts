/**
 * Safe Header Update Hook
 * 
 * Prevents navigation.setOptions infinite loops by:
 * 1. Only updating when values actually change
 * 2. Using ref to track last value
 * 3. Stable dependencies
 * 
 * CRITICAL: Use this instead of raw navigation.setOptions in useLayoutEffect
 */

import { useLayoutEffect, useRef } from "react";
import { useNavigation } from "expo-router";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

function serializeOptions(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "function") {
        return "__function__";
      }
      if (
        nestedValue &&
        typeof nestedValue === "object" &&
        "$$typeof" in (nestedValue as Record<string, unknown>)
      ) {
        return "__react_element__";
      }
      return nestedValue;
    });
  } catch {
    return "__non_serializable__";
  }
}

/**
 * Safely update navigation header options without causing loops.
 * 
 * @example
 * // Instead of:
 * useLayoutEffect(() => {
 *   navigation.setOptions({ headerTitle: title });
 * }, [navigation, title]);
 * 
 * // Use:
 * useSafeHeader({ headerTitle: title });
 */
export function useSafeHeader(
  options: Partial<
    NativeStackNavigationOptions & {
      footer?: unknown;
      detents?: unknown;
      detentIndex?: number;
      maxHeight?: number;
      scrollable?: boolean;
      dimmed?: boolean;
    }
  >,
  deps: readonly unknown[] = []
): void {
  const navigation = useNavigation();
  const lastOptionsRef = useRef<string>("");
  const lastDepsRef = useRef<readonly unknown[]>([]);

  useLayoutEffect(() => {
    // Serialize options to detect changes
    const optionsKey = serializeOptions(options);
    const depsUnchanged =
      lastDepsRef.current.length === deps.length &&
      deps.every((dep, index) => Object.is(dep, lastDepsRef.current[index]));
    
    // Only update if options actually changed
    if (lastOptionsRef.current === optionsKey && depsUnchanged) {
      return;
    }
    
    lastOptionsRef.current = optionsKey;
    lastDepsRef.current = deps;
    navigation.setOptions(options);
  }, [navigation, options, ...deps]);
}

/**
 * Safely update header title only.
 * More efficient than full options update.
 * 
 * @example
 * useSafeHeaderTitle(peerUsername || "Chat");
 */
export function useSafeHeaderTitle(title: string): void {
  const navigation = useNavigation();
  const lastTitleRef = useRef<string>("");

  useLayoutEffect(() => {
    if (lastTitleRef.current === title) {
      return;
    }
    
    lastTitleRef.current = title;
    navigation.setOptions({ headerTitle: title });
  }, [navigation, title]);
}

/**
 * Safely update header with custom component.
 * 
 * @example
 * useSafeHeaderComponent(
 *   () => <SheetHeader title={title} onClose={() => router.back()} />,
 *   [title]
 * );
 */
export function useSafeHeaderComponent(
  headerComponent: () => React.ReactElement,
  deps: any[] = []
): void {
  const navigation = useNavigation();
  const mountedRef = useRef(false);

  useLayoutEffect(() => {
    // Only set once on mount, or when deps change
    if (!mountedRef.current) {
      mountedRef.current = true;
    }
    
    navigation.setOptions({
      header: headerComponent,
    });
  }, [navigation, ...deps]);
}
