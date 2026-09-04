/**
 * Tiny React bridge for `@moq/signals` Getters (web only).
 *
 * `@moq` is signals-based, not React-based. Every reactive value (connection
 * status, the `announced` Set, broadcast status) is a `Getter<T>` exposing
 * `peek()` + `subscribe()` — exactly the `useSyncExternalStore` contract. We
 * bridge here instead of pulling in `@moq/signals/react` to avoid coupling to
 * its strict `react@^19` peer range.
 */

import { useSyncExternalStore } from "react";
import type { Getter } from "@moq/signals";

export function useSignalValue<T>(signal: Getter<T>): T {
  return useSyncExternalStore(
    (onChange) => signal.subscribe(() => onChange()),
    () => signal.peek(),
    () => signal.peek(),
  );
}

/**
 * Snapshot a `Signal<Set<T>>` as a STABLE STRING of its contents.
 *
 * `useSignalValue` cannot be used for these. `Connection.Reload.announced`
 * mutates its Set IN PLACE — `#announced.mutate((active) => active.add(path))`
 * in @moq/net/connection/reload.js — so `peek()` returns the same object
 * reference forever. `useSyncExternalStore` compares snapshots with `Object.is`,
 * sees no change, and never re-renders; a `useMemo` keyed on the Set never
 * recomputes either. The symptom is brutal to read backwards: a second
 * broadcaster announces on the wire, the console shows it arriving, and the
 * remote tile simply never appears.
 *
 * Serializing the contents gives React a value that actually changes. Sets here
 * hold one entry per publisher in one room, so the cost is nothing.
 */
export function useSignalSetKey<T>(signal: Getter<Set<T>>): string {
  return useSyncExternalStore(
    (onChange) => signal.subscribe(() => onChange()),
    () => Array.from(signal.peek(), String).sort().join("\n"),
    () => "",
  );
}
